import type { Prisma } from '@prisma/client';
import { cairoDay, cairoDayStart, addDays } from '@shiplynow/shared';
import type { Db } from '../client';
import { getMerchantSetting, getSetting } from '../settings';
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
 * the order fee (fixed plus a share of the products value) and the COD fee, and the rider
 * earns the delivery bonus. Each part has its own key, so posting twice changes nothing.
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
  const fixed = await getMerchantSetting(tx, 'fee.order_fixed_piastres', merchantId);
  const percent = await getMerchantSetting(tx, 'fee.order_percent_bp', merchantId);
  const orderFee = fixed + share(products, percent);
  await post(tx, {
    ...base,
    kind: 'order_fee',
    idempotencyKey: `order:${order.id}:order_fee`,
    data: { productsPiastres: products, fixedPiastres: fixed, percentBp: percent },
    lines: await feeLines(tx, merchantId, orderFee),
  });

  const codBp = await getMerchantSetting(tx, 'fee.cod_percent_bp', merchantId);
  await post(tx, {
    ...base,
    kind: 'cod_fee',
    idempotencyKey: `order:${order.id}:cod_fee`,
    data: { cashPiastres: cash, percentBp: codBp },
    lines: await feeLines(tx, merchantId, share(cash, codBp)),
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

/** A failed delivery is charged the failed delivery fee once per order. */
export async function postDeliveryFailed(
  tx: Tx,
  input: { deliveryId: string; actorUserId: string | null; now: Date },
) {
  const delivery = await tx.delivery.findUniqueOrThrow({
    where: { id: input.deliveryId },
    include: { order: true },
  });
  const merchantId = delivery.order.merchantId;
  const fee = await getMerchantSetting(tx, 'fee.failed_delivery_piastres', merchantId);
  await post(tx, {
    kind: 'failed_fee',
    idempotencyKey: `order:${delivery.orderId}:failed_fee`,
    orderId: delivery.orderId,
    occurredAt: input.now,
    createdById: input.actorUserId,
    memo: delivery.order.number,
    data: { reason: delivery.failedReason },
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
  const perUnit = await getMerchantSetting(
    tx,
    'fee.receiving_per_unit_piastres',
    manifest.merchantId,
  );
  await post(tx, {
    kind: 'receiving_fee',
    idempotencyKey: `manifest:${manifest.id}:receiving_fee`,
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
  const perUnit = await getMerchantSetting(tx, 'fee.return_per_unit_piastres', ret.merchantId);
  await post(tx, {
    kind: 'return_fee',
    idempotencyKey: `return:${ret.id}:return_fee`,
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
 */
export async function accrueStorage(db: Db, day: string) {
  const [year, month] = day.split('-').map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const rows = await db.binStock.findMany({
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
  for (const u of units.values()) {
    const monthly = await getMerchantSetting(
      db,
      'fee.storage_per_unit_month_piastres',
      u.merchantId,
    );
    const fee = Math.floor((u.units * monthly + Math.floor(daysInMonth / 2)) / daysInMonth);
    if (fee <= 0) continue;
    const vat = share(fee, await getSetting(db, 'fee.vat_bp'));
    const entry = await post(db, {
      kind: 'storage_fee',
      idempotencyKey: `storage:${day}:${u.darkStoreId}:${u.merchantId}`,
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

/** The Cairo day that ended most recently, which storage is charged for. */
export function lastClosedDay(now: Date) {
  return addDays(cairoDay(now), -1);
}
