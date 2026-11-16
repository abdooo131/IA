import type { OrderStatus, Prisma } from '@prisma/client';
import { currentStageDue } from '@shiplynow/shared';
import type { Db } from './client';
import { deliveryAttemptsFor } from './finance/contracts';
import { getSetting } from './settings';

const listInclude = {
  merchant: { select: { id: true, name: true } },
  darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
  items: { include: { sku: { select: { sku: true, titleEn: true, titleAr: true } } } },
  deliveries: {
    include: { rider: { include: { user: { select: { name: true } } } } },
    orderBy: { assignedAt: 'desc' },
  },
} satisfies Prisma.OrderInclude;

type ListRow = Prisma.OrderGetPayload<{ include: typeof listInclude }>;

async function slaFor(db: Db, darkStoreId: string) {
  return {
    accept: await getSetting(db, 'sla.accept_minutes', darkStoreId),
    pick: await getSetting(db, 'sla.pick_minutes', darkStoreId),
    pack: await getSetting(db, 'sla.pack_minutes', darkStoreId),
    handover: await getSetting(db, 'sla.handover_minutes', darkStoreId),
    ride: await getSetting(db, 'sla.ride_minutes', darkStoreId),
  };
}

function summarize(o: ListRow, sla: Awaited<ReturnType<typeof slaFor>> | null, now: Date) {
  const stage = sla ? currentStageDue(o, sla) : null;
  const delivery = o.deliveries[0];
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    source: o.source,
    merchant: o.merchant,
    darkStore: o.darkStore,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    phoneFlagged: o.phoneFlagged,
    addressText: o.addressText,
    /** The Shopify buyer asked to be forgotten: merchants see the order without them */
    buyerHidden: o.buyerRedactedAt !== null,
    paymentMethod: o.paymentMethod,
    subtotalPiastres: o.subtotalPiastres,
    deliveryFeePiastres: o.deliveryFeePiastres,
    codAmountPiastres: o.codAmountPiastres,
    placedAt: o.placedAt,
    slaDueAt: o.slaDueAt,
    slaStartsAt: o.slaStartsAt,
    deliveredAt: o.deliveredAt,
    closedReason: o.closedReason,
    retryHoldUntil: o.retryHoldUntil,
    // Deliveries are newest first: the goods of the last failed attempt are back in the store.
    goodsBack: o.status === 'attempt_failed' && Boolean(delivery?.returnedAt),
    lateStage: o.lateStage,
    stage: stage ? { stage: stage.stage, dueAt: stage.dueAt, late: stage.dueAt < now } : null,
    units: o.items.reduce((s, i) => s + i.quantity - i.cancelledQty, 0),
    items: o.items.map((i) => ({
      skuId: i.skuId,
      sku: i.sku.sku,
      titleEn: i.sku.titleEn,
      titleAr: i.sku.titleAr,
      quantity: i.quantity,
      pickedQty: i.pickedQty,
      cancelledQty: i.cancelledQty,
      unitPricePiastres: i.unitPricePiastres,
    })),
    rider: delivery
      ? { name: delivery.rider.user.name, badge: delivery.rider.badgeCode, status: delivery.status }
      : null,
  };
}

export type OrderSummary = ReturnType<typeof summarize>;

/**
 * What a merchant may see of an order whose Shopify buyer asked to be forgotten (customers/redact
 * or shop/redact): the order, its goods and money stay, the buyer's name, phone, address, note,
 * point, rating comment and delivery photos are blanked. The company keeps them.
 */
export function forMerchant<T extends OrderSummary>(order: T): T {
  if (!order.buyerHidden) return order;
  const out: Record<string, unknown> = {
    ...order,
    customerName: '',
    customerPhone: '',
    addressText: '',
  };
  if ('customerNote' in out) out.customerNote = null;
  if ('latitude' in out) out.latitude = null;
  if ('longitude' in out) out.longitude = null;
  if ('rating' in out && out.rating)
    out.rating = { ...(out.rating as Record<string, unknown>), comment: null };
  if ('deliveries' in out && Array.isArray(out.deliveries))
    out.deliveries = (out.deliveries as Record<string, unknown>[]).map((d) =>
      'proofPhotoId' in d ? { ...d, proofPhotoId: null, failedPhotoId: null } : d,
    );
  return out as T;
}

export interface OrderListFilter {
  /** One store, or a person's stores ({ in: [...] }) */
  darkStoreId?: string | { in: string[] };
  merchantId?: string | { in: string[] };
  statuses?: OrderStatus[];
  from?: Date;
  to?: Date;
  q?: string;
  lateOnly?: boolean;
  take?: number;
  /** The merchant's own screens: buyers hidden by a Shopify redact are blanked (forMerchant) */
  merchantView?: boolean;
}

/** Orders with their current SLA stage, newest first (or by promise time for active queues). */
export async function listOrders(
  db: Db,
  filter: OrderListFilter,
  order: 'promise' | 'newest' = 'newest',
) {
  const where: Prisma.OrderWhereInput = {
    ...(filter.darkStoreId && { darkStoreId: filter.darkStoreId }),
    ...(filter.merchantId && { merchantId: filter.merchantId }),
    ...(filter.statuses && { status: { in: filter.statuses } }),
    ...((filter.from || filter.to) && {
      placedAt: { ...(filter.from && { gte: filter.from }), ...(filter.to && { lt: filter.to }) },
    }),
    ...(filter.lateOnly && { lateStage: { not: null } }),
    ...(filter.q && {
      OR: [
        { number: { contains: filter.q, mode: 'insensitive' } },
        // A buyer hidden from the merchant cannot be found by their name or phone either.
        {
          customerName: { contains: filter.q, mode: 'insensitive' },
          ...(filter.merchantView && { buyerRedactedAt: null }),
        },
        {
          customerPhone: { contains: filter.q },
          ...(filter.merchantView && { buyerRedactedAt: null }),
        },
      ],
    }),
  };
  const rows = await db.order.findMany({
    where,
    include: listInclude,
    orderBy:
      order === 'promise' ? [{ slaDueAt: 'asc' }, { placedAt: 'asc' }] : { placedAt: 'desc' },
    take: Math.min(filter.take ?? 200, 1000),
  });
  const now = new Date();
  const slaCache = new Map<string, Awaited<ReturnType<typeof slaFor>>>();
  const out: OrderSummary[] = [];
  for (const row of rows) {
    if (!slaCache.has(row.darkStoreId))
      slaCache.set(row.darkStoreId, await slaFor(db, row.darkStoreId));
    const summary = summarize(row, slaCache.get(row.darkStoreId)!, now);
    out.push(filter.merchantView ? forMerchant(summary) : summary);
  }
  return out;
}

/** One order with everything staff, admin or the merchant may need. */
export async function getOrderDetail(db: Db, orderId: string) {
  const o = await db.order.findUnique({
    where: { id: orderId },
    include: {
      ...listInclude,
      zone: { select: { code: true, nameEn: true, nameAr: true } },
      createdBy: { select: { name: true } },
      geoArea: {
        select: { nameEn: true, nameAr: true, parent: { select: { nameEn: true, nameAr: true } } },
      },
      rating: true,
      events: { include: { actor: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
      alerts: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!o) return null;
  const summary = summarize(o, await slaFor(db, o.darkStoreId), new Date());
  const maxAttempts = await deliveryAttemptsFor(db, {
    merchantId: o.merchantId,
    darkStoreId: o.darkStoreId,
    at: o.createdAt,
  });
  // Where each still needed unit can be picked from, fullest shelf first.
  const shelves = await db.binStock.findMany({
    where: {
      skuId: { in: o.items.map((i) => i.skuId) },
      quantity: { gt: 0 },
      bin: { darkStoreId: o.darkStoreId, type: 'pickable', isActive: true },
    },
    include: { bin: { select: { id: true, code: true } } },
    orderBy: { quantity: 'desc' },
  });
  // Product pictures from the merchant's Shopify catalogue, when we have one.
  const skus = await db.sku.findMany({
    where: { id: { in: o.items.map((i) => i.skuId) } },
    select: { id: true, shopifyProductId: true, barcode: true },
  });
  const productIds = skus.map((s) => s.shopifyProductId).filter((x): x is string => !!x);
  const pictures = productIds.length
    ? await db.shopProduct.findMany({
        where: { merchantId: o.merchantId, shopifyId: { in: productIds } },
        select: { shopifyId: true, imageUrl: true },
      })
    : [];
  const pictureOf = (skuId: string) => {
    const product = skus.find((s) => s.id === skuId)?.shopifyProductId;
    return pictures.find((p) => p.shopifyId === product)?.imageUrl ?? null;
  };
  return {
    ...summary,
    deliveryOtp: o.deliveryOtp,
    trackingToken: o.trackingToken,
    customerNote: o.customerNote,
    latitude: o.latitude,
    longitude: o.longitude,
    zone: o.zone,
    createdBy: o.createdBy?.name ?? null,
    acceptedAt: o.acceptedAt,
    pickingStartedAt: o.pickingStartedAt,
    pickedAt: o.pickedAt,
    packedAt: o.packedAt,
    outForDeliveryAt: o.outForDeliveryAt,
    closedAt: o.closedAt,
    packPhotoId: o.packPhotoId,
    shopifyOrderId: o.shopifyOrderId,
    maxAttempts,
    area: o.geoArea
      ? {
          nameEn: o.geoArea.nameEn,
          nameAr: o.geoArea.nameAr,
          parent: o.geoArea.parent
            ? { nameEn: o.geoArea.parent.nameEn, nameAr: o.geoArea.parent.nameAr }
            : null,
        }
      : null,
    rating: o.rating
      ? { stars: o.rating.stars, comment: o.rating.comment, at: o.rating.createdAt }
      : null,
    items: summary.items.map((i) => ({
      ...i,
      imageUrl: pictureOf(i.skuId),
      barcode: skus.find((s) => s.id === i.skuId)?.barcode ?? null,
      bins: shelves
        .filter((s) => s.skuId === i.skuId)
        .map((s) => ({ id: s.bin.id, code: s.bin.code, quantity: s.quantity })),
    })),
    deliveries: o.deliveries.map((d) => ({
      id: d.id,
      status: d.status,
      rider: d.rider.user.name,
      badge: d.rider.badgeCode,
      tripId: d.tripId,
      pickedUpAt: d.pickedUpAt,
      deliveredAt: d.deliveredAt,
      failedAt: d.failedAt,
      failedReason: d.failedReason,
      callAttempts: d.callAttempts,
      failedPhotoId: d.failedPhotoId,
      returnedAt: d.returnedAt,
      otpVerified: d.otpVerified,
      proofPhotoId: d.proofPhotoId,
      codExpectedPiastres: d.codExpectedPiastres,
      codCollectedPiastres: d.codCollectedPiastres,
    })),
    events: o.events.map((e) => ({
      at: e.createdAt,
      type: e.type,
      by: e.actor?.name ?? null,
      data: e.data,
    })),
    alerts: o.alerts.map((a) => ({
      id: a.id,
      type: a.type,
      stage: a.stage,
      data: a.data,
      createdAt: a.createdAt,
      resolvedAt: a.resolvedAt,
    })),
  };
}

export type OrderDetail = NonNullable<Awaited<ReturnType<typeof getOrderDetail>>>;
