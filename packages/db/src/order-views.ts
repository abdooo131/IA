import type { OrderStatus, Prisma } from '@prisma/client';
import { currentStageDue } from '@shiplynow/shared';
import type { Db } from './client';
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
    paymentMethod: o.paymentMethod,
    subtotalPiastres: o.subtotalPiastres,
    deliveryFeePiastres: o.deliveryFeePiastres,
    codAmountPiastres: o.codAmountPiastres,
    placedAt: o.placedAt,
    slaDueAt: o.slaDueAt,
    deliveredAt: o.deliveredAt,
    closedReason: o.closedReason,
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

export interface OrderListFilter {
  darkStoreId?: string;
  merchantId?: string;
  statuses?: OrderStatus[];
  from?: Date;
  to?: Date;
  q?: string;
  lateOnly?: boolean;
  take?: number;
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
        { customerName: { contains: filter.q, mode: 'insensitive' } },
        { customerPhone: { contains: filter.q } },
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
    out.push(summarize(row, slaCache.get(row.darkStoreId)!, now));
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
      events: { include: { actor: { select: { name: true } } }, orderBy: { createdAt: 'asc' } },
      alerts: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!o) return null;
  const summary = summarize(o, await slaFor(db, o.darkStoreId), new Date());
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
  return {
    ...summary,
    deliveryOtp: o.deliveryOtp,
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
    items: summary.items.map((i) => ({
      ...i,
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
