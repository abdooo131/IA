import type { OrderStatus } from '@prisma/client';
import type { Db } from './client';

export interface KpiFilter {
  from: Date;
  to: Date;
  darkStoreId?: string;
  merchantId?: string;
}

export interface StageAverages {
  accept: number | null;
  pick: number | null;
  pack: number | null;
  handover: number | null;
  ride: number | null;
}

export interface KpiTotals {
  orders: number;
  delivered: number;
  onTime: number;
  /** Share of delivered orders that arrived by the promise time, 0 to 1 */
  onTimeRate: number | null;
  avgDeliveryMinutes: number | null;
  medianDeliveryMinutes: number | null;
  stageAvgMinutes: StageAverages;
  late: number;
  cancelled: number;
  failed: number;
  movedToStandard: number;
  active: number;
  unitsDelivered: number;
  unitsMissing: number;
  deliveredValuePiastres: number;
  deliveryFeesPiastres: number;
  codExpectedPiastres: number;
  codCollectedPiastres: number;
}

export interface Kpis {
  from: string;
  to: string;
  totals: KpiTotals;
  byStatus: Partial<Record<OrderStatus, number>>;
  perStore: (KpiTotals & {
    darkStore: { id: string; code: string; nameEn: string; nameAr: string };
  })[];
  perMerchant: (KpiTotals & { merchant: { id: string; name: string } })[];
  /** One row per Cairo calendar day in the range that had orders */
  perDay: { date: string; orders: number; delivered: number; onTime: number }[];
}

type Row = Awaited<ReturnType<typeof load>>[number];

const minutes = (from: Date | null, to: Date | null) =>
  from && to ? (to.getTime() - from.getTime()) / 60_000 : null;

function average(values: (number | null)[]) {
  const list = values.filter((v): v is number => v !== null && v >= 0);
  return list.length ? Math.round((list.reduce((s, v) => s + v, 0) / list.length) * 10) / 10 : null;
}

function median(values: (number | null)[]) {
  const list = values.filter((v): v is number => v !== null && v >= 0).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  const value = list.length % 2 ? list[mid]! : (list[mid - 1]! + list[mid]!) / 2;
  return Math.round(value * 10) / 10;
}

const ACTIVE: OrderStatus[] = ['new', 'accepted', 'picking', 'packed', 'out_for_delivery'];

function totalsOf(rows: Row[]): KpiTotals {
  const delivered = rows.filter((o) => o.status === 'delivered');
  const onTime = delivered.filter(
    (o) => o.slaDueAt && o.deliveredAt && o.deliveredAt <= o.slaDueAt,
  );
  const deliveryMinutes = delivered.map((o) => minutes(o.placedAt, o.deliveredAt));
  const deliveries = rows.flatMap((o) => o.deliveries);
  return {
    orders: rows.length,
    delivered: delivered.length,
    onTime: onTime.length,
    onTimeRate: delivered.length
      ? Math.round((onTime.length / delivered.length) * 1000) / 1000
      : null,
    avgDeliveryMinutes: average(deliveryMinutes),
    medianDeliveryMinutes: median(deliveryMinutes),
    stageAvgMinutes: {
      accept: average(rows.map((o) => minutes(o.placedAt, o.acceptedAt))),
      pick: average(rows.map((o) => minutes(o.acceptedAt, o.pickedAt))),
      pack: average(rows.map((o) => minutes(o.pickedAt, o.packedAt))),
      handover: average(rows.map((o) => minutes(o.packedAt, o.outForDeliveryAt))),
      ride: average(delivered.map((o) => minutes(o.outForDeliveryAt, o.deliveredAt))),
    },
    late: rows.filter((o) => o.lateStage !== null || o.events.length > 0).length,
    cancelled: rows.filter((o) => o.status === 'cancelled').length,
    failed: rows.filter((o) => o.status === 'failed').length,
    movedToStandard: rows.filter((o) => o.status === 'moved_to_standard').length,
    active: rows.filter((o) => ACTIVE.includes(o.status)).length,
    unitsDelivered: delivered.reduce((s, o) => s + o.items.reduce((t, i) => t + i.pickedQty, 0), 0),
    unitsMissing: rows.reduce((s, o) => s + o.items.reduce((t, i) => t + i.cancelledQty, 0), 0),
    deliveredValuePiastres: delivered.reduce((s, o) => s + o.subtotalPiastres, 0),
    deliveryFeesPiastres: delivered.reduce((s, o) => s + o.deliveryFeePiastres, 0),
    codExpectedPiastres: deliveries
      .filter((d) => d.status === 'delivered')
      .reduce((s, d) => s + d.codExpectedPiastres, 0),
    codCollectedPiastres: deliveries.reduce((s, d) => s + (d.codCollectedPiastres ?? 0), 0),
  };
}

function load(db: Db, filter: KpiFilter) {
  return db.order.findMany({
    where: {
      placedAt: { gte: filter.from, lt: filter.to },
      darkStoreId: filter.darkStoreId,
      merchantId: filter.merchantId,
    },
    select: {
      status: true,
      placedAt: true,
      slaDueAt: true,
      acceptedAt: true,
      pickedAt: true,
      packedAt: true,
      outForDeliveryAt: true,
      deliveredAt: true,
      lateStage: true,
      subtotalPiastres: true,
      deliveryFeePiastres: true,
      darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      merchant: { select: { id: true, name: true } },
      items: { select: { pickedQty: true, cancelledQty: true } },
      deliveries: {
        select: { status: true, codExpectedPiastres: true, codCollectedPiastres: true },
      },
      // An order counts as late if any stage was ever flagged, even after it caught up.
      events: { where: { type: 'late' }, select: { id: true }, take: 1 },
    },
  });
}

const cairoDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' });

/** Operational KPIs for orders placed in [from, to). Money stays in piastres. */
export async function computeKpis(db: Db, filter: KpiFilter): Promise<Kpis> {
  const rows = await load(db, filter);

  const byStatus: Partial<Record<OrderStatus, number>> = {};
  for (const o of rows) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;

  const group = <K extends string, V>(key: (r: Row) => K, info: (r: Row) => V) => {
    const map = new Map<K, { info: V; rows: Row[] }>();
    for (const r of rows) {
      const k = key(r);
      const entry = map.get(k) ?? { info: info(r), rows: [] };
      entry.rows.push(r);
      map.set(k, entry);
    }
    return [...map.values()];
  };

  const perStore = group(
    (r) => r.darkStore.id,
    (r) => r.darkStore,
  )
    .map((g) => ({ darkStore: g.info, ...totalsOf(g.rows) }))
    .sort((a, b) => a.darkStore.code.localeCompare(b.darkStore.code));

  const perMerchant = group(
    (r) => r.merchant.id,
    (r) => r.merchant,
  )
    .map((g) => ({ merchant: g.info, ...totalsOf(g.rows) }))
    .sort((a, b) => b.orders - a.orders);

  const perDay = group(
    (r) => cairoDay.format(r.placedAt),
    (r) => cairoDay.format(r.placedAt),
  )
    .map((g) => {
      const t = totalsOf(g.rows);
      return { date: g.info, orders: t.orders, delivered: t.delivered, onTime: t.onTime };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    from: filter.from.toISOString(),
    to: filter.to.toISOString(),
    totals: totalsOf(rows),
    byStatus,
    perStore,
    perMerchant,
    perDay,
  };
}
