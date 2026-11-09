import type { Prisma } from '@prisma/client';
import {
  addDays,
  APP_LISTS,
  type AppListApp,
  appListMeta,
  appListRefs,
  cairoDay,
  cairoDayStart,
  canDo,
  type GroupValue,
  LIST_MAX_ROWS,
  type ListCtx,
  type ListDef,
  type ListQuery,
  type ListResult,
  type ListState,
  monthOfDay,
  previousMonth,
} from '@shiplynow/shared';
import type { Db } from './client';
import { listGaps, type ListScope, queryList, type RegisteredList } from './list-query';

// The list views of the other apps (UX phase C, step 1: Operations): orders, alerts and
// damage reports. Each loads its most recent rows (LIST_MAX_ROWS) inside the person's stores
// and merchants, narrowed in the database by the value filters chosen (store, merchant, days),
// and the shared list engine applies the rest of the address.

const named = (key: string | null, label: string | null): GroupValue => ({
  key: key ?? '-',
  label: label ?? '-',
});
const storeIn = (scope: ListScope) => (scope.storeIds ? { in: scope.storeIds } : undefined);
const merchantIn = (scope: ListScope) =>
  scope.merchantIds ? { in: scope.merchantIds } : undefined;

/** A chosen store or merchant narrows the load, inside the person's scope. */
function within(chosen: string | undefined, allowed: string[] | null) {
  if (chosen) return allowed && !allowed.includes(chosen) ? { in: [] as string[] } : chosen;
  return allowed ? { in: allowed } : undefined;
}

/** Placed (or created) between the chosen first and last Cairo days, both included. */
function dayRange(state: ListState) {
  const from = state.values.from;
  const to = state.values.to;
  if (!from && !to) return undefined;
  return {
    ...(from && { gte: cairoDayStart(from) }),
    ...(to && { lt: cairoDayStart(addDays(to, 1)) }),
  };
}

/** The date filters on a Cairo day. */
function dayFilters<R>(dayOf: (r: R) => string) {
  return {
    today: { group: 'date', test: (r: R, ctx: ListCtx) => dayOf(r) === ctx.today },
    yesterday: {
      group: 'date',
      test: (r: R, ctx: ListCtx) => dayOf(r) === addDays(ctx.today, -1),
    },
    last_7_days: {
      group: 'date',
      test: (r: R, ctx: ListCtx) => dayOf(r) >= addDays(ctx.today, -6),
    },
    this_month: {
      group: 'date',
      test: (r: R, ctx: ListCtx) => monthOfDay(dayOf(r)) === monthOfDay(ctx.today),
    },
    last_month: {
      group: 'date',
      test: (r: R, ctx: ListCtx) => monthOfDay(dayOf(r)) === previousMonth(monthOfDay(ctx.today)),
    },
  };
}
const pick = <T extends Record<string, unknown>, K extends keyof T>(o: T, keys: K[]) =>
  Object.fromEntries(keys.map((k) => [k, o[k]])) as Pick<T, K>;

/** An Egyptian mobile as typed locally too (+201001234567 → 01001234567), for search. */
const localPhone = (phone: string) => (phone.startsWith('+20') ? `0${phone.slice(3)}` : phone);

// ─── orders ─────────────────────────────────────────────────────────────────────

/** Statuses that end an order: anything else is still in progress. */
const FINISHED = ['delivered', 'cancelled', 'failed', 'moved_to_standard'];

export interface OrderListRow {
  id: string;
  number: string;
  status: string;
  source: string;
  payment: string;
  storeId: string;
  store: string;
  merchantId: string;
  merchant: string;
  customer: string;
  phone: string;
  phoneFlagged: boolean;
  address: string;
  placedAt: string;
  placedDay: string;
  promiseAt: string | null;
  deliveredAt: string | null;
  lateStage: string | null;
  wasLate: boolean;
  deliveredLate: boolean;
  rider: string | null;
  units: number;
  cod: number;
  value: number;
  deliveryFee: number;
}

async function loadOrders(db: Db, scope: ListScope, state: ListState): Promise<OrderListRow[]> {
  const rows = await db.order.findMany({
    where: {
      darkStoreId: within(state.values.store, scope.storeIds),
      merchantId: within(state.values.merchant, scope.merchantIds),
      placedAt: dayRange(state),
    },
    select: {
      id: true,
      number: true,
      status: true,
      source: true,
      paymentMethod: true,
      darkStoreId: true,
      darkStore: { select: { code: true } },
      merchantId: true,
      merchant: { select: { name: true } },
      customerName: true,
      customerPhone: true,
      phoneFlagged: true,
      addressText: true,
      placedAt: true,
      slaDueAt: true,
      deliveredAt: true,
      lateStage: true,
      subtotalPiastres: true,
      deliveryFeePiastres: true,
      codAmountPiastres: true,
      items: { select: { quantity: true, cancelledQty: true } },
      deliveries: {
        select: { rider: { select: { user: { select: { name: true } } } } },
        orderBy: { assignedAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { placedAt: 'desc' },
    take: LIST_MAX_ROWS,
  });
  // "Were late": any stage of the order was ever flagged late (as the KPIs count it).
  const late = new Set(
    (
      await db.alert.findMany({
        where: { type: 'late', orderId: { in: rows.map((r) => r.id) } },
        select: { orderId: true },
        distinct: ['orderId'],
      })
    ).map((a) => a.orderId),
  );
  return rows.map((o) => ({
    id: o.id,
    number: o.number,
    status: o.status,
    source: o.source,
    payment: o.paymentMethod,
    storeId: o.darkStoreId,
    store: o.darkStore.code,
    merchantId: o.merchantId,
    merchant: o.merchant.name,
    customer: o.customerName,
    phone: o.customerPhone,
    phoneFlagged: o.phoneFlagged,
    address: o.addressText,
    placedAt: o.placedAt.toISOString(),
    placedDay: cairoDay(o.placedAt),
    promiseAt: o.slaDueAt?.toISOString() ?? null,
    deliveredAt: o.deliveredAt?.toISOString() ?? null,
    lateStage: o.lateStage,
    wasLate: late.has(o.id) || o.lateStage !== null,
    deliveredLate: Boolean(o.deliveredAt && o.slaDueAt && o.deliveredAt > o.slaDueAt),
    rider: o.deliveries[0]?.rider.user.name ?? null,
    units: o.items.reduce((s, i) => s + i.quantity - i.cancelledQty, 0),
    cod: o.codAmountPiastres,
    value: o.subtotalPiastres,
    deliveryFee: o.deliveryFeePiastres,
  }));
}

const status = (s: string) => ({ group: 'status', test: (r: OrderListRow) => r.status === s });

const orders: ListDef<OrderListRow> = {
  id: 'orders',
  filters: {
    active: { group: 'status', test: (r) => !FINISHED.includes(r.status) },
    ...Object.fromEntries(
      ['new', 'accepted', 'picking', 'packed', 'out_for_delivery', 'attempt_failed'].map((s) => [
        s,
        status(s),
      ]),
    ),
    ...Object.fromEntries(FINISHED.map((s) => [s, status(s)])),
    late_now: { group: 'late', test: (r) => r.lateStage !== null },
    was_late: { group: 'late', test: (r) => r.wasLate },
    delivered_late: { group: 'late', test: (r) => r.deliveredLate },
    cod: { group: 'payment', test: (r) => r.payment === 'cod' },
    prepaid: { group: 'payment', test: (r) => r.payment === 'prepaid' },
    shopify: { group: 'source', test: (r) => r.source === 'shopify' },
    manual: { group: 'source', test: (r) => r.source === 'manual' },
    phone_flagged: { group: 'flags', test: (r) => r.phoneFlagged },
    ...dayFilters<OrderListRow>((r) => r.placedDay),
  },
  values: {
    store: (r, v) => r.storeId === v,
    merchant: (r, v) => r.merchantId === v,
    from: (r, v) => r.placedDay >= v,
    to: (r, v) => r.placedDay <= v,
  },
  groupBys: {
    store: (r) => named(r.storeId, r.store),
    status: (r) => named(r.status, r.status),
    merchant: (r) => named(r.merchantId, r.merchant),
    day: (r) => named(r.placedDay, r.placedDay),
    payment: (r) => named(r.payment, r.payment),
    source: (r) => named(r.source, r.source),
  },
  search: (r) => [r.number, r.customer, r.phone, localPhone(r.phone), r.merchant, r.store],
  sorts: {
    number: (r) => r.number,
    placed: (r) => r.placedAt,
    promise: (r) => r.promiseAt,
    cod: (r) => r.cod,
    value: (r) => r.value,
  },
  defaultSort: { key: 'placed', desc: true },
  sums: APP_LISTS.operations.orders.sums,
};

// ─── alerts ─────────────────────────────────────────────────────────────────────

export interface AlertListRow {
  id: string;
  type: string;
  stage: string | null;
  data: Record<string, unknown> | null;
  orderId: string | null;
  orderNumber: string | null;
  storeId: string | null;
  store: string | null;
  createdAt: string;
  createdDay: string;
  open: boolean;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

/**
 * The alerts a person may see (as GET /admin/alerts): their stores' alerts; document alerts
 * only for HR, sales follow ups only for sales managers; account managers get their merchants'.
 */
export function alertWhereFor(scope: ListScope): Prisma.AlertWhereInput {
  const access = scope.access;
  const hidden = [
    ...(!access || !canDo(access, 'hr', 'view') ? ['document_expiring', 'document_expired'] : []),
    ...(!access || !canDo(access, 'sales', 'manage')
      ? ['crm_followup_overdue', 'crm_deal_stale']
      : []),
  ];
  const merchants = merchantIn(scope);
  return {
    darkStoreId: storeIn(scope),
    type: { notIn: hidden },
    ...(merchants && { OR: [{ merchantId: merchants }, { order: { merchantId: merchants } }] }),
  };
}

async function loadAlerts(db: Db, scope: ListScope, state: ListState): Promise<AlertListRow[]> {
  const base = alertWhereFor(scope);
  const chosenStore = state.values.store;
  const rows = await db.alert.findMany({
    where: {
      ...base,
      AND: [
        ...(chosenStore ? [{ darkStoreId: within(chosenStore, scope.storeIds) }] : []),
        ...(state.values.type ? [{ type: state.values.type }] : []),
      ],
      // An alert that needs nobody's attention any more is fetched only when asked for.
      ...(state.filters.includes('open') &&
        !state.filters.includes('handled') && { resolvedAt: null }),
    },
    include: {
      order: { select: { number: true } },
      darkStore: { select: { code: true } },
      resolvedBy: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: LIST_MAX_ROWS,
  });
  return rows.map((a) => ({
    id: a.id,
    type: a.type,
    stage: a.stage,
    data: (a.data as Record<string, unknown> | null) ?? null,
    orderId: a.orderId,
    orderNumber: a.order?.number ?? null,
    storeId: a.darkStoreId,
    store: a.darkStore?.code ?? null,
    createdAt: a.createdAt.toISOString(),
    createdDay: cairoDay(a.createdAt),
    open: a.resolvedAt === null,
    resolvedAt: a.resolvedAt?.toISOString() ?? null,
    resolvedBy: a.resolvedBy?.name ?? null,
  }));
}

const alerts: ListDef<AlertListRow> = {
  id: 'alerts',
  filters: {
    open: { group: 'status', test: (r) => r.open },
    handled: { group: 'status', test: (r) => !r.open },
    with_order: { group: 'order', test: (r) => r.orderId !== null },
    ...pick(
      dayFilters<AlertListRow>((r) => r.createdDay),
      ['today', 'last_7_days', 'this_month'],
    ),
  },
  values: {
    type: (r, v) => r.type === v,
    store: (r, v) => r.storeId === v,
  },
  groupBys: {
    type: (r) => named(r.type, r.type),
    store: (r) => named(r.storeId, r.store),
    day: (r) => named(r.createdDay, r.createdDay),
  },
  search: (r) => [
    r.type,
    r.orderNumber,
    r.store,
    r.resolvedBy,
    ...Object.values(r.data ?? {}).map((v) =>
      typeof v === 'string' || typeof v === 'number' ? v : null,
    ),
  ],
  sorts: { created: (r) => r.createdAt, type: (r) => r.type },
  defaultSort: { key: 'created', desc: true },
  sums: APP_LISTS.operations.alerts.sums,
};

// ─── damage reports ─────────────────────────────────────────────────────────────

/** Causes for which the company pays the merchant (as settleDamage). */
const COMPANY_CAUSES = ['store_handling', 'delivery'];

export interface DamageListRow {
  id: string;
  status: string;
  cause: string;
  sku: string;
  titleEn: string;
  titleAr: string;
  quantity: number;
  storeId: string;
  store: string;
  merchantId: string;
  merchant: string;
  rider: string | null;
  reportedBy: string;
  createdAt: string;
  createdDay: string;
  settledBy: string | null;
  value: number;
  compensation: number;
  riderCharge: number;
}

async function loadDamage(db: Db, scope: ListScope, state: ListState): Promise<DamageListRow[]> {
  const rows = await db.damageReport.findMany({
    where: {
      darkStoreId: within(state.values.store, scope.storeIds),
      merchantId: within(state.values.merchant, scope.merchantIds),
    },
    include: {
      sku: { select: { sku: true, titleEn: true, titleAr: true, pricePiastres: true } },
      merchant: { select: { name: true } },
      darkStore: { select: { code: true } },
      rider: { select: { badgeCode: true, user: { select: { name: true } } } },
      reportedBy: { select: { name: true } },
      settledBy: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: LIST_MAX_ROWS,
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    cause: r.cause,
    sku: r.sku.sku,
    titleEn: r.sku.titleEn,
    titleAr: r.sku.titleAr,
    quantity: r.quantity,
    storeId: r.darkStoreId,
    store: r.darkStore.code,
    merchantId: r.merchantId,
    merchant: r.merchant.name,
    rider: r.rider ? `${r.rider.user.name} (${r.rider.badgeCode})` : null,
    reportedBy: r.reportedBy.name,
    createdAt: r.createdAt.toISOString(),
    createdDay: cairoDay(r.createdAt),
    settledBy: r.settledBy?.name ?? null,
    value: r.quantity * r.sku.pricePiastres,
    compensation: r.compensationPiastres,
    riderCharge: r.riderChargePiastres,
  }));
}

const damage: ListDef<DamageListRow> = {
  id: 'damage',
  filters: {
    pending: { group: 'status', test: (r) => r.status === 'pending' },
    settled: { group: 'status', test: (r) => r.status === 'settled' },
    ...Object.fromEntries(
      ['arrived_damaged', 'store_handling', 'delivery', 'customer', 'expired'].map((c) => [
        c,
        { group: 'cause', test: (r: DamageListRow) => r.cause === c },
      ]),
    ),
    company_pays: { group: 'who_pays', test: (r) => COMPANY_CAUSES.includes(r.cause) },
    ...pick(
      dayFilters<DamageListRow>((r) => r.createdDay),
      ['last_7_days', 'this_month', 'last_month'],
    ),
  },
  values: {
    store: (r, v) => r.storeId === v,
    merchant: (r, v) => r.merchantId === v,
  },
  groupBys: {
    cause: (r) => named(r.cause, r.cause),
    store: (r) => named(r.storeId, r.store),
    merchant: (r) => named(r.merchantId, r.merchant),
    status: (r) => named(r.status, r.status),
    month: (r) => named(monthOfDay(r.createdDay), monthOfDay(r.createdDay)),
  },
  search: (r) => [r.sku, r.titleEn, r.titleAr, r.merchant, r.store, r.rider, r.reportedBy],
  sorts: {
    created: (r) => r.createdAt,
    quantity: (r) => r.quantity,
    value: (r) => r.value,
  },
  defaultSort: { key: 'created', desc: true },
  sums: APP_LISTS.inventory.damage.sums,
};

// ─── the registry ───────────────────────────────────────────────────────────────

export const APP_LIST_DEFS: Record<string, Record<string, RegisteredList>> = {
  operations: {
    orders: { def: orders, load: loadOrders },
    alerts: { def: alerts, load: loadAlerts },
  },
  inventory: {
    damage: { def: damage, load: loadDamage },
  },
} satisfies Record<AppListApp, Record<string, RegisteredList>>;

/** One list of an app for the address; null when the app has no such list. */
export async function queryAppList(
  db: Db,
  app: string,
  id: string,
  query: ListQuery,
  scope: ListScope,
  now: Date = new Date(),
): Promise<ListResult<Record<string, unknown>> | null> {
  const meta = appListMeta(app, id);
  const entry = APP_LIST_DEFS[app]?.[id];
  if (!meta || !entry) return null;
  return queryList(db, entry, meta, query, scope, now);
}

/** The values a list's option filters offer the person: their stores, merchants, types. */
export async function appListOptions(db: Db, app: string, id: string, scope: ListScope) {
  const meta = appListMeta(app, id);
  if (!meta) return null;
  const wants = Object.entries(meta.values ?? {})
    .filter(([, kind]) => kind === 'option')
    .map(([k]) => k);
  const out: Record<string, { value: string; label: string; labelAr?: string }[]> = {};
  if (wants.includes('store')) {
    const stores = await db.darkStore.findMany({
      where: { id: storeIn(scope), ...(id === 'orders' && { kind: 'dark_store' }) },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { code: 'asc' },
    });
    out.store = stores.map((s) => ({
      value: s.id,
      label: `${s.code} · ${s.nameEn}`,
      labelAr: `${s.code} · ${s.nameAr}`,
    }));
  }
  if (wants.includes('merchant')) {
    const merchants = await db.merchant.findMany({
      where: { id: merchantIn(scope) },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    out.merchant = merchants.map((m) => ({ value: m.id, label: m.name }));
  }
  if (wants.includes('type')) {
    const types = await db.alert.findMany({
      where: alertWhereFor(scope),
      select: { type: true },
      distinct: ['type'],
      orderBy: { type: 'asc' },
    });
    out.type = types.map((t) => ({ value: t.type, label: t.type }));
  }
  return out;
}

/** For tests: every filter, value, grouping and sort the shared meta names exists. */
export function appListGaps(): string[] {
  return appListRefs().flatMap(({ app, id }) => {
    const entry = APP_LIST_DEFS[app]?.[id];
    const meta = appListMeta(app, id);
    if (!entry || !meta) return [`${app}.${id}.missing`];
    return listGaps(`${app}.${id}`, meta, entry);
  });
}
