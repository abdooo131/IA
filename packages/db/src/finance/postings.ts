import type { Prisma } from '@prisma/client';
import {
  addDays,
  cairoDay,
  cairoDayStart,
  failedDeliveryCharge,
  productHandlingCharge,
  shipmentCharges,
} from '@shiplynow/shared';
import type { Db } from '../client';
import { DomainError } from '../domain-error';
import { getSetting } from '../settings';
import { contractPricesAt, productPricesFor, standardPrices } from './contracts';
import { type AccountRef, post, share } from './ledger';

type Tx = Prisma.TransactionClient;

/**
 * Lines that charge a merchant a fee plus VAT: the merchant's balance goes down by both,
 * the fee is our income and the VAT is owed to the tax authority.
 */
async function feeLines(tx: Tx, merchantId: string, fee: number) {
  const vat = share(fee, await getSetting(tx, 'fee.vat_bp'));
  const merchant: AccountRef = { type: 'merchant', merchantId };
  return [
    { account: merchant, amount: fee + vat },
    { account: { type: 'revenue' } as AccountRef, amount: -fee },
    { account: { type: 'vat_payable' } as AccountRef, amount: -vat },
  ];
}

/**
 * A delivered order: the cash the rider collected now belongs to the merchant, we charge
 * at the prices of the merchant's contract (merchant contracts v2) the shipping fee, the
 * per product prices of the delivered units, the order fee (fixed plus a share of the
 * products value), the COD fee and the packaging charge (each its own entry kind, nothing
 * booked at 0), and the rider earns the delivery bonus. Each part has its own key, so
 * posting twice changes nothing.
 */
export async function postDeliveryCompleted(
  tx: Tx,
  input: { deliveryId: string; actorUserId: string | null; now: Date },
) {
  const delivery = await tx.delivery.findUniqueOrThrow({
    where: { id: input.deliveryId },
    include: { order: { include: { items: true } } },
  });
  const order = delivery.order;
  const merchantId = order.merchantId;
  const base = {
    orderId: order.id,
    occurredAt: input.now,
    createdById: input.actorUserId,
    memo: order.number,
  };

  const cash = delivery.codCollectedPiastres ?? 0;
  await post(tx, {
    ...base,
    kind: 'cod_collected',
    idempotencyKey: `delivery:${delivery.id}:cod`,
    data: { deliveryId: delivery.id, riderId: delivery.riderId },
    lines: [
      { account: { type: 'rider_cash', riderId: delivery.riderId }, amount: cash },
      { account: { type: 'merchant', merchantId }, amount: -cash },
    ],
  });

  const products = order.items.reduce((s, i) => s + i.pickedQty * i.unitPricePiastres, 0);
  // The contract in force on the delivery day, at the band of this order's place in the
  // month, field by field down to the standard price.
  const terms = await contractPricesAt(tx, { merchantId, orderId: order.id, at: input.now });
  const tierData = terms.tierFrom !== null ? { tierFrom: terms.tierFrom, nth: terms.nth } : {};

  const shippingFee = terms.prices.shippingFeePiastres;
  await post(tx, {
    ...base,
    kind: 'shipping_fee',
    idempotencyKey: `order:${order.id}:shipping_fee`,
    data: { shippingFeePiastres: shippingFee, ...tierData },
    lines: await feeLines(tx, merchantId, shippingFee),
  });

  // Per product prices: every delivered (picked) unit at its product's price; units
  // cancelled before delivery are never charged. Tiers do not apply.
  const units = order.items
    .filter((i) => i.pickedQty > 0)
    .map((i) => ({ skuId: i.skuId, units: i.pickedQty }));
  const unitPrices = await productPricesFor(
    tx,
    terms.versionId,
    units.map((u) => u.skuId),
  );
  const handling = productHandlingCharge(units, unitPrices);
  await post(tx, {
    ...base,
    kind: 'product_handling',
    idempotencyKey: `order:${order.id}:product_handling`,
    data: {
      lines: units
        .filter((u) => unitPrices.has(u.skuId))
        .map((u) => ({ ...u, pricePiastres: unitPrices.get(u.skuId)! })),
    },
    lines: await feeLines(tx, merchantId, handling),
  });

  const fixed = terms.prices.orderFixedPiastres;
  const percent = terms.prices.orderPercentBp;
  const orderFee = fixed + share(products, percent);
  await post(tx, {
    ...base,
    kind: 'order_fee',
    idempotencyKey: `order:${order.id}:order_fee`,
    data: {
      productsPiastres: products,
      fixedPiastres: fixed,
      percentBp: percent,
      ...tierData,
    },
    lines: await feeLines(tx, merchantId, orderFee),
  });

  const codBp = terms.prices.codPercentBp;
  await post(tx, {
    ...base,
    kind: 'cod_fee',
    idempotencyKey: `order:${order.id}:cod_fee`,
    data: { cashPiastres: cash, percentBp: codBp },
    lines: await feeLines(tx, merchantId, share(cash, codBp)),
  });

  // Packaging is our cost unless the contract sets a packaging charge.
  const packaging = terms.prices.packagingChargePiastres;
  await post(tx, {
    ...base,
    kind: 'packaging_charge',
    idempotencyKey: `order:${order.id}:packaging_charge`,
    data: { packagingChargePiastres: packaging, ...tierData },
    lines: await feeLines(tx, merchantId, packaging),
  });

  const bonus = await getSetting(tx, 'rider.bonus_per_delivery_piastres', order.darkStoreId);
  await post(tx, {
    ...base,
    kind: 'rider_bonus',
    idempotencyKey: `delivery:${delivery.id}:bonus`,
    data: { riderId: delivery.riderId },
    lines: [
      { account: { type: 'rider_bonus_expense' }, amount: bonus },
      { account: { type: 'rider_bonus', riderId: delivery.riderId }, amount: -bonus },
    ],
  });
}

/**
 * A failed delivery is charged on every failed attempt (one entry per delivery): the
 * contract's fixed failed delivery fee, or a share of what the shipment would have cost
 * (shipping fee, per product prices of its units, order fee fixed and percent; never the COD
 * fee, no cash was collected), at the band the next delivered order would take
 * (failedDeliveryRule).
 */
export async function postDeliveryFailed(
  tx: Tx,
  input: { deliveryId: string; actorUserId: string | null; now: Date },
) {
  const delivery = await tx.delivery.findUniqueOrThrow({
    where: { id: input.deliveryId },
    include: { order: { include: { items: true } } },
  });
  const order = delivery.order;
  const merchantId = order.merchantId;
  const terms = await contractPricesAt(tx, { merchantId, at: input.now });
  let fee: number;
  let detail: Record<string, unknown>;
  if (terms.failed.mode === 'fixed') {
    fee = terms.failed.piastres;
    detail = { mode: 'fixed' };
  } else {
    // The units that went out with the rider (picked), at the shipment's own prices.
    const units = order.items
      .filter((i) => i.pickedQty > 0)
      .map((i) => ({ skuId: i.skuId, units: i.pickedQty }));
    const unitPrices = await productPricesFor(
      tx,
      terms.versionId,
      units.map((u) => u.skuId),
    );
    const products = order.items.reduce((s, i) => s + i.pickedQty * i.unitPricePiastres, 0);
    const handling = productHandlingCharge(units, unitPrices);
    const shipment = shipmentCharges(terms.prices, {
      productsPiastres: products,
      productHandlingPiastres: handling,
    });
    fee = failedDeliveryCharge(terms.failed, shipment);
    detail = { mode: 'percent', percentBp: terms.failed.bp, shipmentPiastres: shipment };
  }
  await post(tx, {
    kind: 'failed_fee',
    // One fee per attempt. Entries posted before this key existed were keyed
    // order:<order id>:failed_fee (one per order); they stay valid as they are.
    idempotencyKey: `delivery:${delivery.id}:failed_fee`,
    orderId: delivery.orderId,
    occurredAt: input.now,
    createdById: input.actorUserId,
    memo: order.number,
    data: { reason: delivery.failedReason, ...detail },
    lines: await feeLines(tx, merchantId, fee),
  });
}

/** Receiving is charged per unit when staff close a shipment. */
export async function postReceivingFee(
  tx: Tx,
  input: { manifestId: string; actorUserId: string | null; now: Date },
) {
  const manifest = await tx.inboundManifest.findUniqueOrThrow({
    where: { id: input.manifestId },
    include: { lines: true },
  });
  const units = manifest.lines.reduce((s, l) => s + l.receivedQty, 0);
  const { prices } = await contractPricesAt(tx, {
    merchantId: manifest.merchantId,
    at: input.now,
  });
  const perUnit = prices.receivingPerUnitPiastres;
  await post(tx, {
    kind: 'receiving_fee',
    idempotencyKey: `manifest:${manifest.id}:receiving_fee`,
    darkStoreId: manifest.darkStoreId,
    occurredAt: input.now,
    createdById: input.actorUserId,
    memo: manifest.reference,
    data: { manifestId: manifest.id, units, perUnitPiastres: perUnit },
    lines: await feeLines(tx, manifest.merchantId, units * perUnit),
  });
}

/** Units sent back to the merchant are charged per unit when the parcel is collected. */
export async function postReturnFee(
  tx: Tx,
  input: { returnId: string; actorUserId: string | null; now: Date },
) {
  const ret = await tx.merchantReturn.findUniqueOrThrow({
    where: { id: input.returnId },
    include: { lines: true },
  });
  const units = ret.lines.reduce((s, l) => s + l.pickedQty, 0);
  const { prices } = await contractPricesAt(tx, { merchantId: ret.merchantId, at: input.now });
  const perUnit = prices.returnPerUnitPiastres;
  await post(tx, {
    kind: 'return_fee',
    idempotencyKey: `return:${ret.id}:return_fee`,
    darkStoreId: ret.darkStoreId,
    occurredAt: input.now,
    createdById: input.actorUserId,
    memo: ret.reference,
    data: { returnId: ret.id, units, perUnitPiastres: perUnit },
    lines: await feeLines(tx, ret.merchantId, units * perUnit),
  });
}

/**
 * Charges storage for one Cairo day: the units each merchant has in each store (every
 * bin, sellable or not) times the monthly rate divided by the days in that month. Run
 * after the day ends; each store and merchant is charged once per day whatever happens.
 * `given` is the units of that day (the daily job passes the day's snapshot, storage.ts);
 * without it the units held now are charged.
 */
export async function accrueStorage(
  db: Db,
  day: string,
  given?: { darkStoreId: string; merchantId: string; units: number }[],
) {
  const [year, month] = day.split('-').map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const rows = given
    ? given.map((g) => ({
        quantity: g.units,
        bin: { darkStoreId: g.darkStoreId },
        sku: { merchantId: g.merchantId },
      }))
    : await db.binStock.findMany({
        where: { quantity: { gt: 0 } },
        select: {
          quantity: true,
          bin: { select: { darkStoreId: true } },
          sku: { select: { merchantId: true } },
        },
      });
  const units = new Map<string, { darkStoreId: string; merchantId: string; units: number }>();
  for (const r of rows) {
    const key = `${r.bin.darkStoreId}:${r.sku.merchantId}`;
    const entry = units.get(key) ?? {
      darkStoreId: r.bin.darkStoreId,
      merchantId: r.sku.merchantId,
      units: 0,
    };
    entry.units += r.quantity;
    units.set(key, entry);
  }
  // The entry belongs to the last moment of that day, so statements put it on that day.
  const occurredAt = new Date(cairoDayStart(addDays(day, 1)).getTime() - 1);
  let charged = 0;
  const standard = await standardPrices(db);
  for (const u of units.values()) {
    // The contract in force that day, at the band the month's deliveries reached by its end.
    const { prices } = await contractPricesAt(db, {
      merchantId: u.merchantId,
      at: occurredAt,
      standard,
    });
    const monthly = prices.storagePerUnitMonthPiastres;
    const fee = Math.floor((u.units * monthly + Math.floor(daysInMonth / 2)) / daysInMonth);
    if (fee <= 0) continue;
    const vat = share(fee, await getSetting(db, 'fee.vat_bp'));
    const entry = await postUnlessClosed(db, {
      kind: 'storage_fee',
      idempotencyKey: `storage:${day}:${u.darkStoreId}:${u.merchantId}`,
      darkStoreId: u.darkStoreId,
      occurredAt,
      memo: day,
      data: { day, darkStoreId: u.darkStoreId, units: u.units, monthlyPiastres: monthly },
      lines: [
        { account: { type: 'merchant', merchantId: u.merchantId }, amount: fee + vat },
        { account: { type: 'revenue' }, amount: -fee },
        { account: { type: 'vat_payable' }, amount: -vat },
      ],
    });
    if (entry) charged++;
  }
  return { day, charged };
}

/** A storage day already inside closed books is skipped, never retried forever. */
async function postUnlessClosed(db: Db, input: Parameters<typeof post>[1]) {
  try {
    return await post(db, input);
  } catch (error) {
    if (error instanceof DomainError && error.code === 'books_closed') return null;
    throw error;
  }
}

/** The Cairo day that ended most recently, which storage is charged for. */
export function lastClosedDay(now: Date) {
  return addDays(cairoDay(now), -1);
}
