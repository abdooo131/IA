import { randomUUID } from 'node:crypto';
import type { OrderStatus, PaymentMethod, Prisma } from '@prisma/client';
import {
  ACTIVE_STATUSES,
  currentStageDue,
  newDeliveryOtp,
  normalizeEgyptianPhone,
} from '@shiplynow/shared';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';
import { notifyMerchant } from './notifications';
import { getSetting } from './settings';
import { pick, receive, release, reserve } from './stock';

// Order rules (CLAUDE.md): every state change is one transaction that locks the order
// row, moves the status with a guarded update, appends an order_events row and writes
// audit_log. Stock moves only through the stock functions, with idempotency keys.

type Tx = Prisma.TransactionClient;
type Actor = string | null;

const PICKABLE_STATES: OrderStatus[] = ['accepted', 'picking'];
const CANCELLABLE_STATES: OrderStatus[] = ['new', 'accepted', 'picking', 'packed'];

// ─── helpers ───────────────────────────────────────────────────────────────────

async function lockOrder(tx: Tx, orderId: string, darkStoreId?: string) {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
  if (rows.length === 0) throw new DomainError('order_not_found', 404);
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: { include: { sku: true } }, darkStore: true },
  });
  if (darkStoreId && order.darkStoreId !== darkStoreId)
    throw new DomainError('order_not_found', 404);
  return order;
}

async function addEvent(
  tx: Tx,
  orderId: string,
  type: string,
  actor: Actor,
  extra: { fromStatus?: OrderStatus; toStatus?: OrderStatus; data?: Prisma.InputJsonValue } = {},
) {
  await tx.orderEvent.create({ data: { orderId, type, actorUserId: actor, ...extra } });
}

/** Moves an order from one of `from` to `to`; fails cleanly if someone else moved it first. */
async function moveStatus(
  tx: Tx,
  order: { id: string; status: OrderStatus },
  to: OrderStatus,
  from: OrderStatus[],
  actor: Actor,
  eventType: string,
  data: Prisma.OrderUncheckedUpdateManyInput = {},
  eventData?: Prisma.InputJsonValue,
) {
  const updated = await tx.order.updateMany({
    where: { id: order.id, status: { in: from } },
    data: { ...data, status: to },
  });
  if (updated.count !== 1) throw new DomainError('invalid_order_state');
  await addEvent(tx, order.id, eventType, actor, {
    fromStatus: order.status,
    toStatus: to,
    data: eventData,
  });
  await recordAudit(tx, {
    actorUserId: actor,
    action: `order.${eventType}`,
    entityType: 'order',
    entityId: order.id,
    before: { status: order.status },
    after: {
      status: to,
      ...(eventData && typeof eventData === 'object' ? { details: eventData } : {}),
    },
  });
}

function remainingOf(item: { quantity: number; pickedQty: number; cancelledQty: number }) {
  return item.quantity - item.pickedQty - item.cancelledQty;
}

async function binForReturn(tx: Tx, darkStoreId: string) {
  const bin =
    (await tx.bin.findFirst({
      where: { darkStoreId, type: 'held', isActive: true },
      orderBy: { code: 'asc' },
    })) ??
    (await tx.bin.findFirst({
      where: { darkStoreId, type: 'receiving', isActive: true },
      orderBy: { code: 'asc' },
    }));
  if (!bin) throw new DomainError('no_return_bin');
  return bin;
}

/** Puts picked units back into the store's held bin (not sellable until staff check them). */
async function returnPickedUnits(
  tx: Tx,
  order: Awaited<ReturnType<typeof lockOrder>>,
  actor: Actor,
  keyPrefix: string,
) {
  const bin = await binForReturn(tx, order.darkStoreId);
  let units = 0;
  for (const item of order.items) {
    if (item.pickedQty === 0) continue;
    const result = await receive(tx, {
      skuId: item.skuId,
      binId: bin.id,
      quantity: item.pickedQty,
      reason: keyPrefix,
      actorUserId: actor,
      idempotencyKey: `${keyPrefix}:${order.id}:${item.skuId}`,
    });
    if (!result.replayed) units += item.pickedQty;
  }
  return { bin: bin.code, units };
}

// ─── intake ────────────────────────────────────────────────────────────────────

export interface CreateOrderInput {
  merchantId: string;
  darkStoreId: string;
  zoneId?: string | null;
  source: 'manual' | 'shopify';
  shopifyOrderId?: string;
  shopifyFulfillmentOrderId?: string;
  customerName: string;
  customerPhone: string;
  addressText: string;
  customerNote?: string;
  latitude?: number;
  longitude?: number;
  paymentMethod: PaymentMethod;
  deliveryFeePiastres: number;
  /** What the customer still owes, when the source knows it (Shopify); otherwise computed */
  codAmountPiastres?: number;
  items: { skuId: string; quantity: number; unitPricePiastres?: number }[];
  placedAt?: Date;
  actorUserId: Actor;
}

export interface CreatedOrder {
  id: string;
  number: string;
  status: OrderStatus;
  phoneFlagged: boolean;
  cancelled: { sku: string; quantity: number }[];
}

/**
 * Creates an order and reserves its stock. Units the store does not have are cancelled
 * on the spot (the rest is still delivered); if nothing is available the order is moved
 * to standard delivery and nothing is reserved.
 */
export function createOrder(db: Db, input: CreateOrderInput): Promise<CreatedOrder> {
  return inTransaction(db, async (tx) => {
    const store = await tx.darkStore.findUnique({ where: { id: input.darkStoreId } });
    if (!store || !store.isActive) throw new DomainError('dark_store_not_found', 404);
    const skuIds = input.items.map((i) => i.skuId);
    if (new Set(skuIds).size !== skuIds.length) throw new DomainError('duplicate_sku', 400);
    const skus = await tx.sku.findMany({
      where: { id: { in: skuIds }, merchantId: input.merchantId, isActive: true },
    });
    if (skus.length !== skuIds.length) throw new DomainError('sku_not_found', 400);

    const [{ n }] = (await tx.$queryRaw<
      { n: bigint }[]
    >`SELECT nextval('order_number_seq') AS n`) as [{ n: bigint }];
    const number = `SN${n}`;
    const phone = normalizeEgyptianPhone(input.customerPhone);
    const placedAt = input.placedAt ?? new Date();
    const promise = await getSetting(tx, 'sla.promise_minutes', store.id);
    const buffer = await getSetting(tx, 'stock.buffer_units', store.id);

    const priced = input.items.map((i) => {
      const sku = skus.find((s) => s.id === i.skuId)!;
      return { ...i, sku, unitPricePiastres: i.unitPricePiastres ?? sku.pricePiastres };
    });

    const order = await tx.order.create({
      data: {
        number,
        merchantId: input.merchantId,
        darkStoreId: store.id,
        zoneId: input.zoneId ?? null,
        source: input.source,
        shopifyOrderId: input.shopifyOrderId,
        shopifyFulfillmentOrderId: input.shopifyFulfillmentOrderId,
        customerName: input.customerName,
        customerPhone: phone ?? input.customerPhone.trim(),
        phoneFlagged: phone === null,
        addressText: input.addressText,
        customerNote: input.customerNote,
        latitude: input.latitude,
        longitude: input.longitude,
        paymentMethod: input.paymentMethod,
        deliveryFeePiastres: input.deliveryFeePiastres,
        subtotalPiastres: 0,
        deliveryOtp: newDeliveryOtp(),
        placedAt,
        slaDueAt: new Date(placedAt.getTime() + promise * 60_000),
        createdById: input.actorUserId,
        items: {
          create: priced.map((i) => ({
            skuId: i.skuId,
            quantity: i.quantity,
            unitPricePiastres: i.unitPricePiastres,
          })),
        },
      },
      include: { items: true },
    });

    let acceptedValue = 0;
    let cancelledValue = 0;
    let acceptedUnits = 0;
    const cancelled: { sku: string; quantity: number }[] = [];
    for (const item of priced) {
      // Lock the level row so two orders cannot both count the same last unit.
      const [level] = await tx.$queryRaw<{ onHand: number; reserved: number }[]>`
        SELECT on_hand AS "onHand", reserved FROM stock_levels
        WHERE dark_store_id = ${store.id} AND sku_id = ${item.skuId} FOR UPDATE`;
      const available = level ? Math.max(0, level.onHand - level.reserved - buffer) : 0;
      const take = Math.min(item.quantity, available);
      if (take > 0) {
        await reserve(tx, {
          darkStoreId: store.id,
          skuId: item.skuId,
          quantity: take,
          orderId: order.id,
          actorUserId: input.actorUserId,
          idempotencyKey: `order:${order.id}:reserve:${item.skuId}`,
        });
      }
      const short = item.quantity - take;
      if (short > 0) {
        await tx.orderItem.updateMany({
          where: { orderId: order.id, skuId: item.skuId },
          data: { cancelledQty: short },
        });
        cancelled.push({ sku: item.sku.sku, quantity: short });
      }
      acceptedUnits += take;
      acceptedValue += take * item.unitPricePiastres;
      cancelledValue += short * item.unitPricePiastres;
    }

    const cod =
      input.paymentMethod !== 'cod'
        ? 0
        : input.codAmountPiastres !== undefined
          ? Math.max(0, input.codAmountPiastres - cancelledValue)
          : acceptedValue + input.deliveryFeePiastres;
    const nothing = acceptedUnits === 0;

    await tx.order.update({
      where: { id: order.id },
      data: {
        subtotalPiastres: acceptedValue,
        codAmountPiastres: nothing ? 0 : cod,
        ...(nothing && {
          status: 'moved_to_standard',
          closedAt: new Date(),
          closedReason: 'no_stock',
        }),
      },
    });

    await addEvent(tx, order.id, 'created', input.actorUserId, {
      toStatus: 'new',
      data: {
        source: input.source,
        items: priced.map((i) => ({ sku: i.sku.sku, quantity: i.quantity })),
      },
    });
    if (cancelled.length > 0) {
      await addEvent(tx, order.id, 'items_cancelled', input.actorUserId, {
        data: { reason: 'no_stock', lines: cancelled },
      });
    }
    if (nothing) {
      await addEvent(tx, order.id, 'moved_to_standard', input.actorUserId, {
        fromStatus: 'new',
        toStatus: 'moved_to_standard',
        data: { reason: 'no_stock' },
      });
    }
    if (phone === null) {
      await tx.alert.create({
        data: {
          type: 'phone_invalid',
          darkStoreId: store.id,
          orderId: order.id,
          data: { phone: input.customerPhone },
        },
      });
    }
    if (nothing || cancelled.length > 0) {
      await notifyMerchant(
        tx,
        input.merchantId,
        nothing ? 'order_moved_to_standard' : 'order_items_cancelled',
        {
          orderId: order.id,
          number,
          reason: 'no_stock',
          lines: cancelled,
        },
      );
    }
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'order.create',
      entityType: 'order',
      entityId: order.id,
      after: {
        number,
        status: nothing ? 'moved_to_standard' : 'new',
        subtotal: acceptedValue,
        cod,
        cancelled,
      },
    });

    return {
      id: order.id,
      number,
      status: nothing ? 'moved_to_standard' : 'new',
      phoneFlagged: phone === null,
      cancelled,
    };
  });
}

// ─── store staff ───────────────────────────────────────────────────────────────

export function acceptOrder(
  db: Db,
  input: { orderId: string; darkStoreId: string; actorUserId: Actor },
) {
  return inTransaction(db, async (tx) => {
    const order = await lockOrder(tx, input.orderId, input.darkStoreId);
    await moveStatus(tx, order, 'accepted', ['new'], input.actorUserId, 'accepted', {
      acceptedAt: new Date(),
    });
  });
}

async function finishPickingIfDone(tx: Tx, orderId: string, actor: Actor) {
  const order = await lockOrder(tx, orderId);
  const done = order.items.every((i) => remainingOf(i) === 0);
  if (!done || order.pickedAt) return order;
  const picked = order.items.reduce((s, i) => s + i.pickedQty, 0);
  if (picked === 0) {
    await moveStatus(tx, order, 'moved_to_standard', PICKABLE_STATES, actor, 'moved_to_standard', {
      closedAt: new Date(),
      closedReason: 'missing_at_pick',
      lateStage: null,
    });
    await notifyMerchant(tx, order.merchantId, 'order_moved_to_standard', {
      orderId: order.id,
      number: order.number,
      reason: 'missing_at_pick',
    });
  } else {
    await tx.order.update({ where: { id: order.id }, data: { pickedAt: new Date() } });
    await addEvent(tx, order.id, 'picking_done', actor);
  }
  return order;
}

export interface PickInput {
  orderId: string;
  darkStoreId: string;
  skuId: string;
  binId?: string;
  quantity: number;
  actorUserId: Actor;
  idempotencyKey: string;
}

/** Staff scanned units of an order off a shelf. Without a bin, the fullest shelf is used. */
export function pickOrderItem(db: Db, input: PickInput) {
  return inTransaction(db, async (tx) => {
    const key = `pick:${input.idempotencyKey}`;
    const seen = await tx.stockMovement.findUnique({ where: { idempotencyKey: key } });
    if (seen) return { replayed: true, bin: null as string | null };

    const order = await lockOrder(tx, input.orderId, input.darkStoreId);
    if (!PICKABLE_STATES.includes(order.status)) throw new DomainError('invalid_order_state');
    const item = order.items.find((i) => i.skuId === input.skuId);
    if (!item) throw new DomainError('sku_not_on_order', 400);
    if (input.quantity > remainingOf(item)) throw new DomainError('over_pick', 400);

    const bin = input.binId
      ? await tx.bin.findUnique({ where: { id: input.binId } })
      : await tx.bin.findFirst({
          where: {
            darkStoreId: order.darkStoreId,
            type: 'pickable',
            isActive: true,
            stock: { some: { skuId: input.skuId, quantity: { gte: input.quantity } } },
          },
          orderBy: { code: 'asc' },
        });
    if (!bin || bin.darkStoreId !== order.darkStoreId) throw new DomainError('not_on_shelf');

    await pick(tx, {
      skuId: input.skuId,
      binId: bin.id,
      quantity: input.quantity,
      orderId: order.id,
      actorUserId: input.actorUserId,
      idempotencyKey: key,
    });
    await tx.orderItem.update({
      where: { id: item.id },
      data: { pickedQty: { increment: input.quantity } },
    });
    if (order.status === 'accepted') {
      await moveStatus(tx, order, 'picking', ['accepted'], input.actorUserId, 'picking_started', {
        pickingStartedAt: new Date(),
      });
    }
    await addEvent(tx, order.id, 'item_picked', input.actorUserId, {
      data: { sku: item.sku.sku, quantity: input.quantity, bin: bin.code },
    });
    await finishPickingIfDone(tx, order.id, input.actorUserId);
    return { replayed: false, bin: bin.code as string | null };
  });
}

/**
 * The shelf does not have the units. They are cancelled from the order (the rest still
 * goes out), the reservation is released, the merchant is told and admin gets an alert
 * to check the shelf. If nothing at all can be picked, the order moves to standard.
 */
export function markItemMissing(
  db: Db,
  input: {
    orderId: string;
    darkStoreId: string;
    skuId: string;
    quantity: number;
    actorUserId: Actor;
    idempotencyKey: string;
  },
) {
  return inTransaction(db, async (tx) => {
    const key = `missing:${input.idempotencyKey}`;
    if (await tx.stockMovement.findUnique({ where: { idempotencyKey: key } }))
      return { replayed: true };

    const order = await lockOrder(tx, input.orderId, input.darkStoreId);
    if (!PICKABLE_STATES.includes(order.status)) throw new DomainError('invalid_order_state');
    const item = order.items.find((i) => i.skuId === input.skuId);
    if (!item) throw new DomainError('sku_not_on_order', 400);
    if (input.quantity > remainingOf(item)) throw new DomainError('over_pick', 400);

    await release(tx, {
      darkStoreId: order.darkStoreId,
      skuId: input.skuId,
      quantity: input.quantity,
      orderId: order.id,
      reason: 'missing_at_pick',
      actorUserId: input.actorUserId,
      idempotencyKey: key,
    });
    const value = input.quantity * item.unitPricePiastres;
    await tx.orderItem.update({
      where: { id: item.id },
      data: { cancelledQty: { increment: input.quantity } },
    });
    await tx.order.update({
      where: { id: order.id },
      data: {
        subtotalPiastres: Math.max(0, order.subtotalPiastres - value),
        codAmountPiastres:
          order.paymentMethod === 'cod' ? Math.max(0, order.codAmountPiastres - value) : 0,
      },
    });
    if (order.status === 'accepted') {
      await moveStatus(tx, order, 'picking', ['accepted'], input.actorUserId, 'picking_started', {
        pickingStartedAt: new Date(),
      });
    }
    const line = { sku: item.sku.sku, quantity: input.quantity };
    await addEvent(tx, order.id, 'item_missing', input.actorUserId, { data: line });
    await tx.alert.create({
      data: { type: 'item_missing', darkStoreId: order.darkStoreId, orderId: order.id, data: line },
    });
    await notifyMerchant(tx, order.merchantId, 'order_items_cancelled', {
      orderId: order.id,
      number: order.number,
      reason: 'missing_at_pick',
      lines: [line],
    });
    await finishPickingIfDone(tx, order.id, input.actorUserId);
    return { replayed: false };
  });
}

export function packOrder(
  db: Db,
  input: { orderId: string; darkStoreId: string; photoId: string; actorUserId: Actor },
) {
  return inTransaction(db, async (tx) => {
    const order = await lockOrder(tx, input.orderId, input.darkStoreId);
    if (order.status !== 'picking' || !order.pickedAt) throw new DomainError('not_fully_picked');
    const photo = await tx.photo.findUnique({
      where: { id: input.photoId },
      select: { kind: true },
    });
    if (!photo || photo.kind !== 'pack') throw new DomainError('photo_required', 400);
    await moveStatus(tx, order, 'packed', ['picking'], input.actorUserId, 'packed', {
      packedAt: new Date(),
      packPhotoId: input.photoId,
    });
  });
}

/**
 * Staff scanned the rider's badge. A rider already carrying orders may take one more
 * only up to delivery.max_orders_per_trip, and only while every order in the trip is
 * still inside its promised time.
 */
export function handToRider(
  db: Db,
  input: {
    orderId: string;
    darkStoreId: string;
    badgeCode: string;
    actorUserId: Actor;
    now?: Date;
  },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    const order = await lockOrder(tx, input.orderId, input.darkStoreId);
    if (order.status !== 'packed') throw new DomainError('invalid_order_state');
    const rider = await tx.rider.findUnique({
      where: { badgeCode: input.badgeCode.trim() },
      include: { user: true },
    });
    if (!rider || !rider.user.isActive) throw new DomainError('rider_not_found', 404);
    if (rider.darkStoreId !== order.darkStoreId) throw new DomainError('rider_other_store');

    const active = await tx.delivery.findMany({
      where: { riderId: rider.id, status: { in: ['assigned', 'picked_up'] } },
      include: { order: true },
    });
    const max = await getSetting(tx, 'delivery.max_orders_per_trip', order.darkStoreId);
    if (active.length >= max) throw new DomainError('rider_full');
    const inSla = (o: { slaDueAt: Date | null }) => !o.slaDueAt || o.slaDueAt > now;
    if (active.length > 0 && !(inSla(order) && active.every((d) => inSla(d.order)))) {
      throw new DomainError('batch_would_break_sla');
    }
    const tripId = active[0]?.tripId ?? randomUUID();

    await tx.delivery.create({
      data: {
        orderId: order.id,
        riderId: rider.id,
        status: 'picked_up',
        tripId,
        assignedAt: now,
        pickedUpAt: now,
        codExpectedPiastres: order.codAmountPiastres,
      },
    });
    await moveStatus(
      tx,
      order,
      'out_for_delivery',
      ['packed'],
      input.actorUserId,
      'handed_to_rider',
      { outForDeliveryAt: now },
      { rider: rider.user.name, badge: rider.badgeCode, tripId, batched: active.length > 0 },
    );
    return { rider: rider.user.name, tripId, batched: active.length > 0 };
  });
}

/** Cancels an order that has not left the store. Reservations are released; picked units go to the held bin. */
export function cancelOrder(
  db: Db,
  input: { orderId: string; reason: string; actorUserId: Actor; darkStoreId?: string },
) {
  return inTransaction(db, async (tx) => {
    const order = await lockOrder(tx, input.orderId, input.darkStoreId);
    if (!CANCELLABLE_STATES.includes(order.status)) throw new DomainError('invalid_order_state');
    for (const item of order.items) {
      const reserved = remainingOf(item);
      if (reserved > 0) {
        await release(tx, {
          darkStoreId: order.darkStoreId,
          skuId: item.skuId,
          quantity: reserved,
          orderId: order.id,
          reason: 'order_cancelled',
          actorUserId: input.actorUserId,
          idempotencyKey: `cancel:${order.id}:${item.skuId}`,
        });
      }
    }
    const returned = await returnPickedUnits(tx, order, input.actorUserId, 'order_cancelled');
    await moveStatus(
      tx,
      order,
      'cancelled',
      CANCELLABLE_STATES,
      input.actorUserId,
      'cancelled',
      { closedAt: new Date(), closedReason: input.reason, lateStage: null },
      { reason: input.reason, returnedUnits: returned.units, bin: returned.bin },
    );
    await notifyMerchant(tx, order.merchantId, 'order_cancelled', {
      orderId: order.id,
      number: order.number,
      reason: input.reason,
    });
  });
}

// ─── riders ────────────────────────────────────────────────────────────────────

async function lockDelivery(tx: Tx, deliveryId: string, riderUserId: string) {
  const delivery = await tx.delivery.findUnique({
    where: { id: deliveryId },
    include: { rider: true },
  });
  if (!delivery || delivery.rider.userId !== riderUserId)
    throw new DomainError('delivery_not_found', 404);
  if (delivery.status !== 'picked_up') throw new DomainError('delivery_closed');
  const order = await lockOrder(tx, delivery.orderId);
  return { delivery, order };
}

export interface CompleteDeliveryInput {
  deliveryId: string;
  riderUserId: string;
  otp?: string;
  photoId?: string;
  codCollectedPiastres?: number;
  now?: Date;
}

/** The customer has the goods: proved by their code or a photo. COD differences raise an alert. */
export function completeDelivery(db: Db, input: CompleteDeliveryInput) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    const { delivery, order } = await lockDelivery(tx, input.deliveryId, input.riderUserId);
    if (!input.otp && !input.photoId) throw new DomainError('proof_required', 400);
    const otpOk = input.otp !== undefined && input.otp === order.deliveryOtp;
    if (input.otp !== undefined && !otpOk) throw new DomainError('wrong_otp', 400);
    if (input.photoId) {
      const photo = await tx.photo.findUnique({
        where: { id: input.photoId },
        select: { kind: true },
      });
      if (!photo || photo.kind !== 'delivery') throw new DomainError('photo_required', 400);
    }
    const isCod = order.paymentMethod === 'cod' && delivery.codExpectedPiastres > 0;
    if (isCod && input.codCollectedPiastres === undefined)
      throw new DomainError('cod_required', 400);
    const collected = isCod ? input.codCollectedPiastres! : null;

    await tx.delivery.update({
      where: { id: delivery.id },
      data: {
        status: 'delivered',
        deliveredAt: now,
        otpVerified: otpOk,
        proofPhotoId: input.photoId,
        codCollectedPiastres: collected,
      },
    });
    await moveStatus(
      tx,
      order,
      'delivered',
      ['out_for_delivery'],
      input.riderUserId,
      'delivered',
      { deliveredAt: now, lateStage: null },
      {
        proof: otpOk ? 'otp' : 'photo',
        codCollected: collected,
        codExpected: delivery.codExpectedPiastres,
      },
    );
    if (collected !== null && collected !== delivery.codExpectedPiastres) {
      await tx.alert.create({
        data: {
          type: 'cod_mismatch',
          darkStoreId: order.darkStoreId,
          orderId: order.id,
          data: { expected: delivery.codExpectedPiastres, collected },
        },
      });
    }
    await notifyMerchant(tx, order.merchantId, 'order_delivered', {
      orderId: order.id,
      number: order.number,
    });
  });
}

/** The rider could not deliver. The goods come back to the store (see returnToStore). */
export function failDelivery(
  db: Db,
  input: { deliveryId: string; riderUserId: string; reason: string; note?: string; now?: Date },
) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    const { delivery, order } = await lockDelivery(tx, input.deliveryId, input.riderUserId);
    await tx.delivery.update({
      where: { id: delivery.id },
      data: {
        status: 'failed',
        failedAt: now,
        failedReason: input.note ? `${input.reason}: ${input.note}` : input.reason,
      },
    });
    await moveStatus(
      tx,
      order,
      'failed',
      ['out_for_delivery'],
      input.riderUserId,
      'delivery_failed',
      { closedAt: now, closedReason: input.reason, lateStage: null },
      { reason: input.reason, note: input.note ?? null },
    );
    await tx.alert.create({
      data: {
        type: 'delivery_failed',
        darkStoreId: order.darkStoreId,
        orderId: order.id,
        data: { reason: input.reason },
      },
    });
    await notifyMerchant(tx, order.merchantId, 'order_failed', {
      orderId: order.id,
      number: order.number,
      reason: input.reason,
    });
  });
}

/** Staff took back the goods of a failed delivery. They go to the held bin to be checked. */
export function returnToStore(
  db: Db,
  input: { orderId: string; darkStoreId: string; actorUserId: Actor },
) {
  return inTransaction(db, async (tx) => {
    const order = await lockOrder(tx, input.orderId, input.darkStoreId);
    if (order.status !== 'failed') throw new DomainError('invalid_order_state');
    const returned = await returnPickedUnits(tx, order, input.actorUserId, 'returned');
    if (returned.units > 0) {
      await addEvent(tx, order.id, 'returned_to_store', input.actorUserId, { data: returned });
      await recordAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'order.returned_to_store',
        entityType: 'order',
        entityId: order.id,
        after: returned,
      });
    }
    return returned;
  });
}

// ─── SLA ───────────────────────────────────────────────────────────────────────

/**
 * Flags orders whose current stage is past due and clears the flag once they move on.
 * Safe to run twice: the alert is unique per order, type and stage.
 */
export async function flagLateOrders(db: Db, now: Date = new Date()) {
  const orders = await db.order.findMany({
    where: { status: { in: ACTIVE_STATUSES as OrderStatus[] } },
    select: {
      id: true,
      darkStoreId: true,
      status: true,
      placedAt: true,
      acceptedAt: true,
      pickedAt: true,
      packedAt: true,
      outForDeliveryAt: true,
      lateStage: true,
    },
  });
  const slaByStore = new Map<
    string,
    { accept: number; pick: number; pack: number; handover: number; ride: number }
  >();
  let flagged = 0;
  for (const order of orders) {
    let sla = slaByStore.get(order.darkStoreId);
    if (!sla) {
      sla = {
        accept: await getSetting(db, 'sla.accept_minutes', order.darkStoreId),
        pick: await getSetting(db, 'sla.pick_minutes', order.darkStoreId),
        pack: await getSetting(db, 'sla.pack_minutes', order.darkStoreId),
        handover: await getSetting(db, 'sla.handover_minutes', order.darkStoreId),
        ride: await getSetting(db, 'sla.ride_minutes', order.darkStoreId),
      };
      slaByStore.set(order.darkStoreId, sla);
    }
    const due = currentStageDue(order, sla);
    const late = due !== null && due.dueAt < now;
    if (late && order.lateStage !== due.stage) {
      await inTransaction(db, async (tx) => {
        const created = await tx.alert.createMany({
          data: [
            {
              type: 'late',
              darkStoreId: order.darkStoreId,
              orderId: order.id,
              stage: due.stage,
              data: { dueAt: due.dueAt.toISOString() },
            },
          ],
          skipDuplicates: true,
        });
        await tx.order.updateMany({
          where: { id: order.id, status: order.status },
          data: { lateStage: due.stage },
        });
        if (created.count === 1) {
          await addEvent(tx, order.id, 'late', null, {
            data: { stage: due.stage, dueAt: due.dueAt.toISOString() },
          });
          flagged++;
        }
      });
    } else if (!late && order.lateStage) {
      await db.order.updateMany({
        where: { id: order.id, status: order.status },
        data: { lateStage: null },
      });
    }
  }
  return { checked: orders.length, flagged };
}
