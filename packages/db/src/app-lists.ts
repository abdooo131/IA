import type { Prisma } from '@prisma/client';
import {
  addDays,
  APP_LISTS,
  basataDepositNumber,
  basataSettlementNumber,
  type AppListApp,
  appListMeta,
  appListRefs,
  cairoDay,
  cairoDayStart,
  canDo,
  contractVersionLabel,
  CUSTOMER_LIST_RISKS,
  CUSTOMER_LIST_SEGMENTS,
  DEAL_LIST_SOURCES,
  DEAL_LIST_STAGES,
  dealNumber,
  EMPLOYEE_LIST_FLAGS,
  employeeCode,
  isOpenStage,
  LEAVE_LIST_STATUSES,
  leaveRequestNumber,
  NO_ACCESS,
  PROPOSAL_LIST_STATUSES,
  proposalNumber,
  SUGGESTION_LIST_STATUSES,
  VIOLATION_LIST_PENALTIES,
  VIOLATION_LIST_STATUSES,
  violationNumber,
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
import { companyScope, type CrmActor, crmActor, dealScope, salesPeople } from './crm';
import { employeeDirectory } from './hr-overview';
import { directReports } from './hr-inbox';
import { getSetting } from './settings';
import { type CustomerListRow, customerListRows } from './shopdata/customer-insights';
import { listGaps, type ListScope, queryList, type RegisteredList } from './list-query';

// The list views of the other apps (UX phase C; step 1 Operations: orders, alerts and damage
// reports; step 2 Inventory: stock, shipments in, transfers, returns and stock counts). Each
// loads its most recent rows (LIST_MAX_ROWS) inside the person's stores and merchants, narrowed
// in the database by the value filters chosen (store, merchant, days), and the shared list
// engine applies the rest of the address.

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
  /** open or handled */
  status: string;
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
    status: a.resolvedAt === null ? 'open' : 'handled',
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

// ─── inventory (UX phase C step 2) ──────────────────────────────────────────────

const sum = <T>(rows: T[], of: (r: T) => number) => rows.reduce((s, r) => s + of(r), 0);
const statusFilter = <R extends { status: string }>(statuses: readonly string[]) =>
  Object.fromEntries(
    statuses.map((s) => [s, { group: 'status', test: (r: R) => r.status === s }]),
  ) as Record<string, { group: string; test: (r: R) => boolean }>;
/** Filters on one field of the row, one per value, all in one group. */
const statusFilterOn = <R>(group: string, values: readonly string[], of: (r: R) => string) =>
  Object.fromEntries(values.map((v) => [v, { group, test: (r: R) => of(r) === v }])) as Record<
    string,
    { group: string; test: (r: R) => boolean }
  >;
const storeRef = { select: { id: true, code: true, kind: true } } as const;

// stock per store and product

export interface StockListRow {
  id: string;
  storeId: string;
  store: string;
  storeKind: string;
  merchantId: string;
  merchant: string;
  skuId: string;
  sku: string;
  barcode: string | null;
  titleEn: string;
  titleAr: string;
  onHand: number;
  reserved: number;
  available: number;
  lowStock: boolean;
  outOfStock: boolean;
  /** out (nothing to sell), low (at or under the threshold) or ok */
  level: 'out' | 'low' | 'ok';
}

/**
 * Stock per store and product, as GET /admin/stock counts it: available is on hand minus
 * reserved minus the store's buffer (never below 0), low when at or under its threshold.
 */
async function loadStock(db: Db, scope: ListScope, state: ListState): Promise<StockListRow[]> {
  const merchants = within(state.values.merchant, scope.merchantIds);
  const levels = await db.stockLevel.findMany({
    where: {
      darkStoreId: within(state.values.store, scope.storeIds),
      ...(merchants && { sku: { merchantId: merchants } }),
    },
    select: {
      darkStoreId: true,
      skuId: true,
      onHand: true,
      reserved: true,
      darkStore: storeRef,
      sku: {
        select: {
          sku: true,
          barcode: true,
          titleEn: true,
          titleAr: true,
          merchantId: true,
          merchant: { select: { name: true } },
        },
      },
    },
    orderBy: [{ darkStore: { code: 'asc' } }, { sku: { sku: 'asc' } }],
    take: LIST_MAX_ROWS,
  });
  const rules = new Map<string, { buffer: number; threshold: number }>();
  for (const id of new Set(levels.map((l) => l.darkStoreId)))
    rules.set(id, {
      buffer: await getSetting(db, 'stock.buffer_units', id),
      threshold: await getSetting(db, 'stock.low_stock_threshold', id),
    });
  return levels.map((l) => {
    const { buffer, threshold } = rules.get(l.darkStoreId)!;
    const available = Math.max(l.onHand - l.reserved - buffer, 0);
    return {
      id: `${l.darkStoreId}:${l.skuId}`,
      storeId: l.darkStoreId,
      store: l.darkStore.code,
      storeKind: l.darkStore.kind,
      merchantId: l.sku.merchantId,
      merchant: l.sku.merchant.name,
      skuId: l.skuId,
      sku: l.sku.sku,
      barcode: l.sku.barcode,
      titleEn: l.sku.titleEn,
      titleAr: l.sku.titleAr,
      onHand: l.onHand,
      reserved: l.reserved,
      available,
      lowStock: available <= threshold,
      outOfStock: available === 0,
      level: available === 0 ? 'out' : available <= threshold ? 'low' : 'ok',
    };
  });
}

const stock: ListDef<StockListRow> = {
  id: 'stock',
  filters: {
    in_stock: { group: 'level', test: (r) => r.available > 0 },
    low_stock: { group: 'level', test: (r) => r.lowStock },
    out_of_stock: { group: 'level', test: (r) => r.outOfStock },
    has_reserved: { group: 'reserved', test: (r) => r.reserved > 0 },
    dark_stores: { group: 'kind', test: (r) => r.storeKind === 'dark_store' },
    hubs: { group: 'kind', test: (r) => r.storeKind === 'hub' },
  },
  values: {
    store: (r, v) => r.storeId === v,
    merchant: (r, v) => r.merchantId === v,
  },
  groupBys: {
    store: (r) => named(r.storeId, r.store),
    merchant: (r) => named(r.merchantId, r.merchant),
    product: (r) => named(r.skuId, `${r.sku} · ${r.titleEn}`),
  },
  search: (r) => [r.sku, r.barcode, r.titleEn, r.titleAr, r.merchant, r.store],
  sorts: {
    sku: (r) => r.sku,
    onHand: (r) => r.onHand,
    reserved: (r) => r.reserved,
    available: (r) => r.available,
  },
  defaultSort: { key: 'sku', desc: false },
  sums: APP_LISTS.inventory.stock.sums,
};

// shipments in (inbound manifests)

export interface ShipmentListRow {
  id: string;
  reference: string;
  status: string;
  storeId: string;
  store: string;
  storeKind: string;
  merchantId: string;
  merchant: string;
  createdAt: string;
  createdDay: string;
  expectedAt: string | null;
  receivedAt: string | null;
  lines: number;
  expectedUnits: number;
  receivedUnits: number;
  /** Units received above what the merchant listed (products not listed included) */
  extraUnits: number;
  /** Units listed but not received, once the shipment is closed */
  shortUnits: number;
}

async function loadShipments(
  db: Db,
  scope: ListScope,
  state: ListState,
): Promise<ShipmentListRow[]> {
  const rows = await db.inboundManifest.findMany({
    where: {
      darkStoreId: within(state.values.store, scope.storeIds),
      merchantId: within(state.values.merchant, scope.merchantIds),
      createdAt: dayRange(state),
    },
    select: {
      id: true,
      reference: true,
      status: true,
      createdAt: true,
      expectedAt: true,
      receivedAt: true,
      darkStoreId: true,
      darkStore: storeRef,
      merchantId: true,
      merchant: { select: { name: true } },
      lines: { select: { expectedQty: true, receivedQty: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: LIST_MAX_ROWS,
  });
  return rows.map((m) => ({
    id: m.id,
    reference: m.reference,
    status: m.status,
    storeId: m.darkStoreId,
    store: m.darkStore.code,
    storeKind: m.darkStore.kind,
    merchantId: m.merchantId,
    merchant: m.merchant.name,
    createdAt: m.createdAt.toISOString(),
    createdDay: cairoDay(m.createdAt),
    expectedAt: m.expectedAt?.toISOString() ?? null,
    receivedAt: m.receivedAt?.toISOString() ?? null,
    lines: m.lines.length,
    expectedUnits: sum(m.lines, (l) => l.expectedQty),
    receivedUnits: sum(m.lines, (l) => l.receivedQty),
    extraUnits: sum(m.lines, (l) => Math.max(0, l.receivedQty - l.expectedQty)),
    shortUnits:
      m.status === 'received' ? sum(m.lines, (l) => Math.max(0, l.expectedQty - l.receivedQty)) : 0,
  }));
}

const shipments: ListDef<ShipmentListRow> = {
  id: 'shipments',
  filters: {
    open: { group: 'status', test: (r) => r.status === 'expected' || r.status === 'receiving' },
    ...statusFilter<ShipmentListRow>(['expected', 'receiving', 'received', 'cancelled']),
    extra: { group: 'difference', test: (r) => r.extraUnits > 0 },
    short: { group: 'difference', test: (r) => r.shortUnits > 0 },
    to_hub: { group: 'kind', test: (r) => r.storeKind === 'hub' },
    to_store: { group: 'kind', test: (r) => r.storeKind === 'dark_store' },
    ...dayFilters<ShipmentListRow>((r) => r.createdDay),
  },
  values: {
    store: (r, v) => r.storeId === v,
    merchant: (r, v) => r.merchantId === v,
    from: (r, v) => r.createdDay >= v,
    to: (r, v) => r.createdDay <= v,
  },
  groupBys: {
    status: (r) => named(r.status, r.status),
    store: (r) => named(r.storeId, r.store),
    merchant: (r) => named(r.merchantId, r.merchant),
    day: (r) => named(r.createdDay, r.createdDay),
    month: (r) => named(monthOfDay(r.createdDay), monthOfDay(r.createdDay)),
  },
  search: (r) => [r.reference, r.merchant, r.store],
  sorts: {
    reference: (r) => r.reference,
    created: (r) => r.createdAt,
    expectedUnits: (r) => r.expectedUnits,
    receivedUnits: (r) => r.receivedUnits,
  },
  defaultSort: { key: 'created', desc: true },
  sums: APP_LISTS.inventory.shipments.sums,
};

// transfers between locations

export interface TransferListRow {
  id: string;
  reference: string;
  status: string;
  origin: string;
  senderId: string;
  sender: string;
  receiverId: string;
  receiver: string;
  destinationId: string | null;
  destination: string | null;
  /** The onward leg from the hub of a store to store transfer */
  onward: boolean;
  createdAt: string;
  createdDay: string;
  sentAt: string | null;
  receivedAt: string | null;
  lines: number;
  units: number;
  pickedUnits: number;
  receivedUnits: number;
  /** Sent fewer units than asked (units not found at the sender) */
  shortSent: boolean;
  /** The receiver closed with fewer units than were sent */
  shortReceived: boolean;
}

/** A person's stores: transfers leaving, reaching or finally going to one of them. */
function anyLeg(ids: string[]): Prisma.TransferWhereInput {
  return {
    OR: [{ fromId: { in: ids } }, { toId: { in: ids } }, { finalDestinationId: { in: ids } }],
  };
}

async function loadTransfers(
  db: Db,
  scope: ListScope,
  state: ListState,
): Promise<TransferListRow[]> {
  const chosen = state.values.store;
  const and: Prisma.TransferWhereInput[] = [];
  if (scope.storeIds) and.push(anyLeg(scope.storeIds));
  if (chosen) and.push(anyLeg([chosen]));
  // A chosen location outside the person's stores shows nothing.
  const picked = [chosen, state.values.sender, state.values.receiver, state.values.destination];
  if (scope.storeIds && picked.some((id) => id && !scope.storeIds!.includes(id)))
    and.push({ id: { in: [] } });
  const rows = await db.transfer.findMany({
    where: {
      AND: and,
      fromId: state.values.sender,
      toId: state.values.receiver,
      finalDestinationId: state.values.destination,
      createdAt: dayRange(state),
    },
    select: {
      id: true,
      reference: true,
      status: true,
      origin: true,
      fromId: true,
      toId: true,
      finalDestinationId: true,
      previousId: true,
      createdAt: true,
      sentAt: true,
      receivedAt: true,
      from: storeRef,
      to: storeRef,
      finalDestination: storeRef,
      lines: { select: { quantity: true, pickedQty: true, receivedQty: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: LIST_MAX_ROWS,
  });
  return rows.map((t) => {
    const units = sum(t.lines, (l) => l.quantity);
    const picked = sum(t.lines, (l) => l.pickedQty);
    const received = sum(t.lines, (l) => l.receivedQty);
    const sent = t.status === 'in_transit' || t.status === 'received';
    return {
      id: t.id,
      reference: t.reference,
      status: t.status,
      origin: t.origin,
      senderId: t.fromId,
      sender: t.from.code,
      receiverId: t.toId,
      receiver: t.to.code,
      destinationId: t.finalDestinationId,
      destination: t.finalDestination?.code ?? null,
      onward: t.previousId !== null,
      createdAt: t.createdAt.toISOString(),
      createdDay: cairoDay(t.createdAt),
      sentAt: t.sentAt?.toISOString() ?? null,
      receivedAt: t.receivedAt?.toISOString() ?? null,
      lines: t.lines.length,
      units,
      pickedUnits: picked,
      receivedUnits: received,
      shortSent: sent && picked < units,
      shortReceived: t.status === 'received' && received < picked,
    };
  });
}

const OPEN_TRANSFER = ['draft', 'approved', 'picking', 'in_transit'];

const transfers: ListDef<TransferListRow> = {
  id: 'transfers',
  filters: {
    open: { group: 'status', test: (r) => OPEN_TRANSFER.includes(r.status) },
    ...statusFilter<TransferListRow>([
      'draft',
      'approved',
      'picking',
      'in_transit',
      'received',
      'cancelled',
    ]),
    manual: { group: 'origin', test: (r) => r.origin === 'manual' },
    refill: { group: 'origin', test: (r) => r.origin === 'refill' },
    short_sent: { group: 'short', test: (r) => r.shortSent },
    short_received: { group: 'short', test: (r) => r.shortReceived },
    via_hub: { group: 'leg', test: (r) => r.destinationId !== null || r.onward },
    ...dayFilters<TransferListRow>((r) => r.createdDay),
  },
  values: {
    store: (r, v) => r.senderId === v || r.receiverId === v || r.destinationId === v,
    sender: (r, v) => r.senderId === v,
    receiver: (r, v) => r.receiverId === v,
    destination: (r, v) => r.destinationId === v,
    from: (r, v) => r.createdDay >= v,
    to: (r, v) => r.createdDay <= v,
  },
  groupBys: {
    status: (r) => named(r.status, r.status),
    sender: (r) => named(r.senderId, r.sender),
    receiver: (r) => named(r.receiverId, r.receiver),
    destination: (r) => named(r.destinationId, r.destination),
    origin: (r) => named(r.origin, r.origin),
    day: (r) => named(r.createdDay, r.createdDay),
  },
  search: (r) => [r.reference, r.sender, r.receiver, r.destination],
  sorts: {
    reference: (r) => r.reference,
    created: (r) => r.createdAt,
    units: (r) => r.units,
  },
  defaultSort: { key: 'created', desc: true },
  sums: APP_LISTS.inventory.transfers.sums,
};

// returns to the merchant

export interface ReturnListRow {
  id: string;
  reference: string;
  status: string;
  storeId: string;
  store: string;
  merchantId: string;
  merchant: string;
  createdAt: string;
  createdDay: string;
  collectedAt: string | null;
  collectedBy: string | null;
  /** Where the units come from: sellable, damaged, held (one or more) */
  sources: string[];
  lines: number;
  units: number;
  pickedUnits: number;
}

async function loadReturns(db: Db, scope: ListScope, state: ListState): Promise<ReturnListRow[]> {
  const rows = await db.merchantReturn.findMany({
    where: {
      darkStoreId: within(state.values.store, scope.storeIds),
      merchantId: within(state.values.merchant, scope.merchantIds),
      createdAt: dayRange(state),
    },
    select: {
      id: true,
      reference: true,
      status: true,
      createdAt: true,
      collectedAt: true,
      collectedBy: true,
      darkStoreId: true,
      darkStore: storeRef,
      merchantId: true,
      merchant: { select: { name: true } },
      lines: { select: { source: true, quantity: true, pickedQty: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: LIST_MAX_ROWS,
  });
  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    status: r.status,
    storeId: r.darkStoreId,
    store: r.darkStore.code,
    merchantId: r.merchantId,
    merchant: r.merchant.name,
    createdAt: r.createdAt.toISOString(),
    createdDay: cairoDay(r.createdAt),
    collectedAt: r.collectedAt?.toISOString() ?? null,
    collectedBy: r.collectedBy,
    sources: [...new Set(r.lines.map((l) => l.source as string))].sort(),
    lines: r.lines.length,
    units: sum(r.lines, (l) => l.quantity),
    pickedUnits: sum(r.lines, (l) => l.pickedQty),
  }));
}

const returns: ListDef<ReturnListRow> = {
  id: 'returns',
  filters: {
    open: {
      group: 'status',
      test: (r) => r.status !== 'collected' && r.status !== 'cancelled',
    },
    ...statusFilter<ReturnListRow>(['requested', 'picking', 'ready', 'collected', 'cancelled']),
    ...Object.fromEntries(
      ['sellable', 'damaged', 'held'].map((s) => [
        s,
        { group: 'source', test: (r: ReturnListRow) => r.sources.includes(s) },
      ]),
    ),
    ...dayFilters<ReturnListRow>((r) => r.createdDay),
  },
  values: {
    store: (r, v) => r.storeId === v,
    merchant: (r, v) => r.merchantId === v,
    from: (r, v) => r.createdDay >= v,
    to: (r, v) => r.createdDay <= v,
  },
  groupBys: {
    status: (r) => named(r.status, r.status),
    store: (r) => named(r.storeId, r.store),
    merchant: (r) => named(r.merchantId, r.merchant),
    day: (r) => named(r.createdDay, r.createdDay),
  },
  search: (r) => [r.reference, r.merchant, r.store, r.collectedBy],
  sorts: {
    reference: (r) => r.reference,
    created: (r) => r.createdAt,
    units: (r) => r.units,
  },
  defaultSort: { key: 'created', desc: true },
  sums: APP_LISTS.inventory.returns.sums,
};

// stock counts

export interface CountListRow {
  id: string;
  status: string;
  storeId: string;
  store: string;
  bin: string;
  binType: string;
  submittedBy: string;
  reviewedBy: string | null;
  createdAt: string;
  createdDay: string;
  reviewedAt: string | null;
  lines: number;
  /** Products whose counted units differ from the system's */
  differences: number;
  /** Counted minus expected, over the whole bin */
  netDifference: number;
  expectedUnits: number;
  countedUnits: number;
}

async function loadCounts(db: Db, scope: ListScope, state: ListState): Promise<CountListRow[]> {
  const rows = await db.stockCount.findMany({
    where: {
      darkStoreId: within(state.values.store, scope.storeIds),
      createdAt: dayRange(state),
    },
    select: {
      id: true,
      status: true,
      createdAt: true,
      reviewedAt: true,
      darkStoreId: true,
      darkStore: storeRef,
      bin: { select: { code: true, type: true } },
      submittedBy: { select: { name: true } },
      reviewedBy: { select: { name: true } },
      lines: { select: { expectedQty: true, countedQty: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: LIST_MAX_ROWS,
  });
  return rows.map((c) => ({
    id: c.id,
    status: c.status,
    storeId: c.darkStoreId,
    store: c.darkStore.code,
    bin: c.bin.code,
    binType: c.bin.type,
    submittedBy: c.submittedBy.name,
    reviewedBy: c.reviewedBy?.name ?? null,
    createdAt: c.createdAt.toISOString(),
    createdDay: cairoDay(c.createdAt),
    reviewedAt: c.reviewedAt?.toISOString() ?? null,
    lines: c.lines.length,
    differences: c.lines.filter((l) => l.countedQty !== l.expectedQty).length,
    netDifference: sum(c.lines, (l) => l.countedQty - l.expectedQty),
    expectedUnits: sum(c.lines, (l) => l.expectedQty),
    countedUnits: sum(c.lines, (l) => l.countedQty),
  }));
}

const counts: ListDef<CountListRow> = {
  id: 'counts',
  filters: {
    ...statusFilter<CountListRow>(['submitted', 'approved', 'rejected', 'stale']),
    with_differences: { group: 'difference', test: (r) => r.differences > 0 },
    no_differences: { group: 'difference', test: (r) => r.differences === 0 },
    ...dayFilters<CountListRow>((r) => r.createdDay),
  },
  values: {
    store: (r, v) => r.storeId === v,
    from: (r, v) => r.createdDay >= v,
    to: (r, v) => r.createdDay <= v,
  },
  groupBys: {
    status: (r) => named(r.status, r.status),
    store: (r) => named(r.storeId, r.store),
    day: (r) => named(r.createdDay, r.createdDay),
  },
  search: (r) => [r.store, r.bin, r.submittedBy, r.reviewedBy],
  sorts: {
    created: (r) => r.createdAt,
    differences: (r) => r.differences,
  },
  defaultSort: { key: 'created', desc: true },
  sums: APP_LISTS.inventory.counts.sums,
};

// ─── merchants and customers (UX phase C step 3) ────────────────────────────────

export interface MerchantListRow {
  id: string;
  name: string;
  legalName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  shopifyDomain: string | null;
  /** pending (linked, not installed), active, uninstalled, or null without a store */
  shopifyStatus: string | null;
  shopifyConnected: boolean;
  isActive: boolean;
  /** active or paused */
  state: string;
  approval: string;
  createdAt: string;
  createdDay: string;
  schedule: string;
  expressPrice: number | null;
  managerId: string | null;
  manager: string | null;
  /** The contract version in force today (CTR-000001 v2), or null */
  contract: string | null;
  skus: number;
  /** Orders placed in the last 30 days */
  orders30: number;
  /** What we owe the merchant (their wallet); below 0 the merchant owes us */
  balance: number;
}

const DAY_MS = 86_400_000;

async function loadMerchants(
  db: Db,
  scope: ListScope,
  state: ListState,
  now: Date,
): Promise<MerchantListRow[]> {
  const rows = await db.merchant.findMany({
    where: {
      id: merchantIn(scope),
      ...(state.values.manager && { accountManagerId: state.values.manager }),
    },
    select: {
      id: true,
      name: true,
      legalName: true,
      contactEmail: true,
      contactPhone: true,
      isActive: true,
      approval: true,
      createdAt: true,
      payoutSchedule: true,
      expressPricePiastres: true,
      shopifyShopDomain: true,
      accountManagerId: true,
      accountManager: { select: { name: true } },
      shopifyShop: { select: { status: true, shopDomain: true } },
      _count: { select: { skus: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: LIST_MAX_ROWS,
  });
  const ids = rows.map((m) => m.id);
  const today = cairoDay(now);
  const [balances, orders, versions] = await Promise.all([
    db.$queryRaw<{ merchant_id: string; owed: bigint }[]>`
      SELECT a.merchant_id, -COALESCE(SUM(l.amount_piastres), 0) AS owed
      FROM ledger_accounts a JOIN ledger_lines l ON l.account_id = a.id
      WHERE a.type = 'merchant' AND a.merchant_id = ANY(${ids})
      GROUP BY a.merchant_id`,
    db.order.groupBy({
      by: ['merchantId'],
      where: { merchantId: { in: ids }, placedAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } },
      _count: { _all: true },
    }),
    db.merchantContractVersion.findMany({
      where: {
        contract: { merchantId: { in: ids } },
        status: { in: ['active', 'superseded'] },
        effectiveFrom: { lte: new Date(`${today}T00:00:00Z`) },
      },
      select: {
        version: true,
        effectiveFrom: true,
        endDate: true,
        contract: { select: { merchantId: true, number: true } },
      },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    }),
  ]);
  const owed = new Map(balances.map((b) => [b.merchant_id, Number(b.owed)]));
  const placed = new Map(orders.map((o) => [o.merchantId, o._count._all]));
  // The version in force is the latest one started (as versionInForce); an end date passed
  // means no contract is in force any more.
  const inForce = new Map<string, string | null>();
  for (const v of versions) {
    const m = v.contract.merchantId;
    if (inForce.has(m)) continue;
    const ended = v.endDate && v.endDate.toISOString().slice(0, 10) < today;
    inForce.set(m, ended ? null : contractVersionLabel(v.contract.number, v.version));
  }
  return rows.map((m) => ({
    id: m.id,
    name: m.name,
    legalName: m.legalName,
    contactEmail: m.contactEmail,
    contactPhone: m.contactPhone,
    shopifyDomain: m.shopifyShop?.shopDomain ?? m.shopifyShopDomain,
    shopifyStatus: m.shopifyShop?.status ?? null,
    shopifyConnected: m.shopifyShop?.status === 'active',
    isActive: m.isActive,
    state: m.isActive ? 'active' : 'paused',
    approval: m.approval,
    createdAt: m.createdAt.toISOString(),
    createdDay: cairoDay(m.createdAt),
    schedule: m.payoutSchedule,
    expressPrice: m.expressPricePiastres,
    managerId: m.accountManagerId,
    manager: m.accountManager?.name ?? null,
    contract: inForce.get(m.id) ?? null,
    skus: m._count.skus,
    orders30: placed.get(m.id) ?? 0,
    balance: owed.get(m.id) ?? 0,
  }));
}

const merchants: ListDef<MerchantListRow> = {
  id: 'merchants',
  filters: {
    active: { group: 'state', test: (r) => r.isActive },
    paused: { group: 'state', test: (r) => !r.isActive },
    ...statusFilterOn<MerchantListRow>(
      'approval',
      ['pending', 'approved', 'rejected'],
      (r) => r.approval,
    ),
    shopify_connected: { group: 'shopify', test: (r) => r.shopifyConnected },
    shopify_not_connected: { group: 'shopify', test: (r) => !r.shopifyConnected },
    express_on: { group: 'express', test: (r) => r.expressPrice !== null },
    express_off: { group: 'express', test: (r) => r.expressPrice === null },
    contract_in_force: { group: 'contract', test: (r) => r.contract !== null },
    no_contract: { group: 'contract', test: (r) => r.contract === null },
    debit_wallet: { group: 'wallet', test: (r) => r.balance < 0 },
    owed_money: { group: 'wallet', test: (r) => r.balance > 0 },
    no_manager: { group: 'manager', test: (r) => r.managerId === null },
  },
  values: { manager: (r, v) => r.managerId === v },
  groupBys: {
    approval: (r) => named(r.approval, r.approval),
    manager: (r) => named(r.managerId, r.manager),
    schedule: (r) => named(r.schedule, r.schedule),
    state: (r) => named(r.state, r.state),
  },
  search: (r) => [
    r.name,
    r.legalName,
    r.contactEmail,
    r.contactPhone,
    r.contactPhone ? localPhone(r.contactPhone) : null,
    r.shopifyDomain,
    r.manager,
  ],
  sorts: {
    name: (r) => r.name.toLowerCase(),
    created: (r) => r.createdAt,
    orders30: (r) => r.orders30,
    skus: (r) => r.skus,
    balance: (r) => r.balance,
  },
  defaultSort: { key: 'name', desc: false },
  sums: APP_LISTS.merchants.merchants.sums,
};

// products (the merchants' catalogue)

export interface ProductListRow {
  id: string;
  sku: string;
  barcode: string | null;
  titleEn: string;
  titleAr: string;
  merchantId: string;
  merchant: string;
  price: number;
  weightGrams: number | null;
  isActive: boolean;
  state: string;
  linked: boolean;
  /** linked or not_linked */
  shopify: string;
  onHand: number;
  reserved: number;
  /** Sellable now over every store: on hand minus reserved minus each store's buffer */
  available: number;
  stores: number;
}

async function loadProducts(db: Db, scope: ListScope, state: ListState): Promise<ProductListRow[]> {
  const rows = await db.sku.findMany({
    where: { merchantId: within(state.values.merchant, scope.merchantIds) },
    select: {
      id: true,
      sku: true,
      barcode: true,
      titleEn: true,
      titleAr: true,
      pricePiastres: true,
      weightGrams: true,
      isActive: true,
      shopifyVariantId: true,
      merchantId: true,
      merchant: { select: { name: true } },
      stockLevels: { select: { darkStoreId: true, onHand: true, reserved: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: LIST_MAX_ROWS,
  });
  const buffers = new Map<string, number>();
  for (const id of new Set(rows.flatMap((r) => r.stockLevels.map((l) => l.darkStoreId))))
    buffers.set(id, await getSetting(db, 'stock.buffer_units', id));
  return rows.map((s) => ({
    id: s.id,
    sku: s.sku,
    barcode: s.barcode,
    titleEn: s.titleEn,
    titleAr: s.titleAr,
    merchantId: s.merchantId,
    merchant: s.merchant.name,
    price: s.pricePiastres,
    weightGrams: s.weightGrams,
    isActive: s.isActive,
    state: s.isActive ? 'active' : 'inactive',
    linked: s.shopifyVariantId !== null,
    shopify: s.shopifyVariantId !== null ? 'linked' : 'not_linked',
    onHand: sum(s.stockLevels, (l) => l.onHand),
    reserved: sum(s.stockLevels, (l) => l.reserved),
    available: sum(s.stockLevels, (l) =>
      Math.max(l.onHand - l.reserved - (buffers.get(l.darkStoreId) ?? 0), 0),
    ),
    stores: s.stockLevels.filter((l) => l.onHand > 0).length,
  }));
}

const products: ListDef<ProductListRow> = {
  id: 'products',
  filters: {
    active: { group: 'state', test: (r) => r.isActive },
    inactive: { group: 'state', test: (r) => !r.isActive },
    linked: { group: 'shopify', test: (r) => r.linked },
    not_linked: { group: 'shopify', test: (r) => !r.linked },
    in_stock: { group: 'stock', test: (r) => r.available > 0 },
    out_of_stock: { group: 'stock', test: (r) => r.available === 0 },
    no_barcode: { group: 'barcode', test: (r) => !r.barcode },
  },
  values: { merchant: (r, v) => r.merchantId === v },
  groupBys: {
    merchant: (r) => named(r.merchantId, r.merchant),
    state: (r) => named(r.state, r.state),
    shopify: (r) => named(r.shopify, r.shopify),
  },
  search: (r) => [r.sku, r.barcode, r.titleEn, r.titleAr, r.merchant],
  sorts: {
    sku: (r) => r.sku,
    title: (r) => r.titleEn.toLowerCase(),
    price: (r) => r.price,
    onHand: (r) => r.onHand,
    available: (r) => r.available,
  },
  defaultSort: { key: 'sku', desc: false },
  sums: APP_LISTS.merchants.products.sums,
};

// customers (named profiles: the API also needs the customer data switch)

const customers: ListDef<CustomerListRow> = {
  id: 'customers',
  filters: {
    ...statusFilterOn<CustomerListRow>('segment', CUSTOMER_LIST_SEGMENTS, (r) => r.segment),
    ...Object.fromEntries(
      CUSTOMER_LIST_RISKS.map((level) => [
        `risk_${level}`,
        { group: 'risk', test: (r: CustomerListRow) => r.risk === level },
      ]),
    ),
    due_to_reorder: { group: 'due', test: (r) => r.due },
    with_phone: { group: 'contact', test: (r) => r.phone !== null },
    with_email: { group: 'contact', test: (r) => r.email !== null },
    several_merchants: { group: 'merchants', test: (r) => r.merchants >= 2 },
  },
  values: {
    merchant: (r, v) => r.merchantIds.includes(v),
    district: (r, v) => r.districtId === v,
  },
  groupBys: {
    segment: (r) => named(r.segment, r.segment),
    district: (r) => named(r.districtId, r.district),
    governorate: (r) => named(r.governorate, r.governorate),
    merchant: (r) => named(r.mainMerchantId, r.mainMerchant),
    risk: (r) => named(r.risk, r.risk),
  },
  search: (r) => [
    r.name,
    r.phone,
    r.phone ? localPhone(r.phone) : null,
    r.email,
    r.city,
    r.district,
    r.districtAr,
  ],
  sorts: {
    name: (r) => r.name.toLowerCase(),
    orders: (r) => r.orders,
    spend: (r) => r.spend,
    last: (r) => r.lastOrderAt,
  },
  defaultSort: { key: 'spend', desc: true },
  sums: APP_LISTS.customers.customers.sums,
};

function loadCustomers(db: Db, scope: ListScope, state: ListState, now: Date) {
  return customerListRows(
    db,
    {
      merchantId: state.values.merchant,
      merchantIds: scope.merchantIds,
      districtId: state.values.district,
      limit: LIST_MAX_ROWS,
    },
    now,
  );
}

// ─── Sales and HR (UX phase C step 4) ───────────────────────────────────────────

/** The sales actor of the person looking (own_deals_only keeps a rep to their own records). */
function salesActor(scope: ListScope): CrmActor {
  return crmActor(scope.access ?? NO_ACCESS, scope.userId);
}

const MINUTE_MS = 60_000;

export interface DealListRow {
  id: string;
  number: string;
  numberValue: number;
  title: string | null;
  companyId: string;
  company: string;
  contact: string | null;
  phone: string | null;
  email: string | null;
  stage: string;
  open: boolean;
  ownerId: string | null;
  owner: string | null;
  source: string;
  createdAt: string;
  createdDay: string;
  month: string;
  stageChangedAt: string;
  expectedFee: number | null;
  expectedOrders: number | null;
  closeDate: string | null;
  nextStep: string | null;
  nextStepAt: string | null;
  followupOverdue: boolean;
  noNextStep: boolean;
  stale: boolean;
  /** The newest proposal's status, or null */
  proposal: string | null;
  proposalSent: boolean;
  proposalAccepted: boolean;
  proposalToApprove: boolean;
  merchantId: string | null;
  merchant: string | null;
}

async function loadDeals(
  db: Db,
  scope: ListScope,
  state: ListState,
  now: Date,
): Promise<DealListRow[]> {
  const actor = salesActor(scope);
  const [overdueMinutes, staleDays] = await Promise.all([
    getSetting(db, 'sales.overdue_minutes'),
    getSetting(db, 'sales.stale_days'),
  ]);
  const owner = state.values.owner;
  const rows = await db.crmDeal.findMany({
    where: {
      AND: [
        dealScope(actor),
        owner && !actor.ownOnly ? { ownerId: owner } : {},
        { createdAt: dayRange(state) },
      ],
    },
    select: {
      id: true,
      number: true,
      title: true,
      stage: true,
      ownerId: true,
      owner: { select: { name: true } },
      createdAt: true,
      stageChangedAt: true,
      expectedMonthlyFeePiastres: true,
      expectedMonthlyOrders: true,
      expectedCloseDate: true,
      merchantId: true,
      merchant: { select: { name: true } },
      company: {
        select: {
          id: true,
          brandName: true,
          source: true,
          contacts: {
            select: { name: true, phone: true, email: true },
            orderBy: { createdAt: 'asc' },
            take: 1,
          },
        },
      },
      activities: {
        where: { doneAt: null, dueAt: { not: null } },
        select: { subject: true, dueAt: true },
        orderBy: { dueAt: 'asc' },
        take: 1,
      },
      proposals: {
        select: {
          status: true,
          needsApproval: true,
          approvedAt: true,
          approvalRequestedAt: true,
        },
        orderBy: { version: 'desc' },
      },
    },
    orderBy: [{ number: 'desc' }],
    take: LIST_MAX_ROWS,
  });
  const staleBefore = now.getTime() - staleDays * DAY_MS;
  const overdueBefore = now.getTime() - overdueMinutes * MINUTE_MS;
  return rows.map((d) => {
    const open = isOpenStage(d.stage);
    const next = d.activities[0] ?? null;
    const contact = d.company.contacts[0] ?? null;
    const createdDay = cairoDay(d.createdAt);
    return {
      id: d.id,
      number: dealNumber(d.number),
      numberValue: d.number,
      title: d.title,
      companyId: d.company.id,
      company: d.company.brandName,
      contact: contact?.name ?? null,
      phone: contact?.phone ?? null,
      email: contact?.email ?? null,
      stage: d.stage,
      open,
      ownerId: d.ownerId,
      owner: d.owner?.name ?? null,
      source: d.company.source,
      createdAt: d.createdAt.toISOString(),
      createdDay,
      month: monthOfDay(createdDay),
      stageChangedAt: d.stageChangedAt.toISOString(),
      expectedFee: d.expectedMonthlyFeePiastres,
      expectedOrders: d.expectedMonthlyOrders,
      closeDate: d.expectedCloseDate?.toISOString().slice(0, 10) ?? null,
      nextStep: next?.subject ?? null,
      nextStepAt: next?.dueAt?.toISOString() ?? null,
      followupOverdue: open && !!next?.dueAt && next.dueAt.getTime() <= overdueBefore,
      noNextStep: open && !next,
      stale: open && d.stageChangedAt.getTime() <= staleBefore,
      proposal: d.proposals[0]?.status ?? null,
      proposalSent: d.proposals.some((p) => ['sent', 'viewed'].includes(p.status)),
      proposalAccepted: d.proposals.some((p) => p.status === 'accepted'),
      proposalToApprove: d.proposals.some(
        (p) => p.status === 'draft' && p.needsApproval && !p.approvedAt && !!p.approvalRequestedAt,
      ),
      merchantId: d.merchantId,
      merchant: d.merchant?.name ?? null,
    };
  });
}

const deals: ListDef<DealListRow> = {
  id: 'deals',
  filters: {
    open_deals: { group: 'stage', test: (r) => r.open },
    ...statusFilterOn<DealListRow>('stage', DEAL_LIST_STAGES, (r) => r.stage),
    mine: { group: 'owner', test: (r, ctx) => r.ownerId === ctx.userId },
    unassigned: { group: 'owner', test: (r) => r.ownerId === null },
    followup_overdue: { group: 'followup', test: (r) => r.followupOverdue },
    no_next_step: { group: 'followup', test: (r) => r.noNextStep },
    stale: { group: 'stale', test: (r) => r.stale },
    ...statusFilterOn<DealListRow>('source', DEAL_LIST_SOURCES, (r) => r.source),
    proposal_sent: { group: 'proposal', test: (r) => r.proposalSent },
    proposal_accepted: { group: 'proposal', test: (r) => r.proposalAccepted },
    proposal_to_approve: { group: 'proposal', test: (r) => r.proposalToApprove },
    ...dayFilters<DealListRow>((r) => r.createdDay),
  },
  values: {
    owner: (r, v) => r.ownerId === v,
    from: (r, v) => r.createdDay >= v,
    to: (r, v) => r.createdDay <= v,
  },
  groupBys: {
    stage: (r) => named(r.stage, r.stage),
    owner: (r) => named(r.ownerId, r.owner),
    source: (r) => named(r.source, r.source),
    month: (r) => named(r.month, r.month),
  },
  search: (r) => [
    r.number,
    String(r.numberValue),
    r.title,
    r.company,
    r.contact,
    r.phone,
    r.phone ? localPhone(r.phone) : null,
    r.email,
  ],
  sorts: {
    number: (r) => r.numberValue,
    created: (r) => r.createdAt,
    stageChanged: (r) => r.stageChangedAt,
    expectedFee: (r) => r.expectedFee,
    expectedOrders: (r) => r.expectedOrders,
    closeDate: (r) => r.closeDate,
  },
  defaultSort: { key: 'number', desc: true },
  sums: APP_LISTS.sales.deals.sums,
};

export interface CompanyListRow {
  id: string;
  name: string;
  website: string | null;
  shopDomain: string | null;
  city: string | null;
  category: string | null;
  source: string;
  ownerId: string | null;
  owner: string | null;
  merchantId: string | null;
  merchant: string | null;
  contacts: number;
  contact: string | null;
  phone: string | null;
  email: string | null;
  openDeals: number;
  wonDeals: number;
  createdAt: string;
}

async function loadCompanies(
  db: Db,
  scope: ListScope,
  state: ListState,
): Promise<CompanyListRow[]> {
  const actor = salesActor(scope);
  const owner = state.values.owner;
  const rows = await db.crmCompany.findMany({
    where: { AND: [companyScope(actor), owner && !actor.ownOnly ? { ownerId: owner } : {}] },
    select: {
      id: true,
      brandName: true,
      website: true,
      shopDomain: true,
      city: true,
      category: true,
      source: true,
      ownerId: true,
      owner: { select: { name: true } },
      merchantId: true,
      merchant: { select: { name: true } },
      createdAt: true,
      contacts: {
        select: { name: true, phone: true, email: true },
        orderBy: { createdAt: 'asc' },
      },
      // A rep with own deals only counts only their own deals.
      deals: { where: dealScope(actor), select: { stage: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: LIST_MAX_ROWS,
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.brandName,
    website: c.website,
    shopDomain: c.shopDomain,
    city: c.city,
    category: c.category,
    source: c.source,
    ownerId: c.ownerId,
    owner: c.owner?.name ?? null,
    merchantId: c.merchantId,
    merchant: c.merchant?.name ?? null,
    contacts: c.contacts.length,
    contact: c.contacts[0]?.name ?? null,
    phone: c.contacts[0]?.phone ?? null,
    email: c.contacts[0]?.email ?? null,
    openDeals: c.deals.filter((d) => isOpenStage(d.stage)).length,
    wonDeals: c.deals.filter((d) => d.stage === 'won').length,
    createdAt: c.createdAt.toISOString(),
  }));
}

const companies: ListDef<CompanyListRow> = {
  id: 'companies',
  filters: {
    ...statusFilterOn<CompanyListRow>('source', DEAL_LIST_SOURCES, (r) => r.source),
    with_merchant: { group: 'merchant', test: (r) => r.merchantId !== null },
    no_merchant: { group: 'merchant', test: (r) => r.merchantId === null },
    with_open_deals: { group: 'deals', test: (r) => r.openDeals > 0 },
    no_open_deals: { group: 'deals', test: (r) => r.openDeals === 0 },
    mine: { group: 'owner', test: (r, ctx) => r.ownerId === ctx.userId },
    unassigned: { group: 'owner', test: (r) => r.ownerId === null },
  },
  values: { owner: (r, v) => r.ownerId === v },
  groupBys: {
    owner: (r) => named(r.ownerId, r.owner),
    source: (r) => named(r.source, r.source),
    city: (r) => named(r.city, r.city),
    category: (r) => named(r.category, r.category),
  },
  search: (r) => [
    r.name,
    r.website,
    r.shopDomain,
    r.city,
    r.category,
    r.contact,
    r.phone,
    r.phone ? localPhone(r.phone) : null,
    r.email,
    r.merchant,
  ],
  sorts: {
    name: (r) => r.name.toLowerCase(),
    created: (r) => r.createdAt,
    openDeals: (r) => r.openDeals,
    wonDeals: (r) => r.wonDeals,
  },
  defaultSort: { key: 'name', desc: false },
  sums: APP_LISTS.sales.companies.sums,
};

export interface ProposalListRow {
  id: string;
  number: string;
  numberValue: number;
  version: number;
  dealId: string;
  deal: string;
  company: string;
  status: string;
  ownerId: string | null;
  owner: string | null;
  createdAt: string;
  month: string;
  createdDay: string;
  sentAt: string | null;
  validUntil: string | null;
  acceptedAt: string | null;
  /** The largest discount against the fee settings, in basis points */
  discount: number;
  discountOverLimit: boolean;
  toApprove: boolean;
  confirmed: boolean;
  expectedOrders: number | null;
}

async function loadProposals(
  db: Db,
  scope: ListScope,
  state: ListState,
): Promise<ProposalListRow[]> {
  const actor = salesActor(scope);
  const owner = state.values.owner;
  const rows = await db.crmProposal.findMany({
    where: {
      deal: { AND: [dealScope(actor), owner && !actor.ownOnly ? { ownerId: owner } : {}] },
    },
    select: {
      id: true,
      number: true,
      version: true,
      status: true,
      createdAt: true,
      sentAt: true,
      validUntil: true,
      acceptedAt: true,
      maxDiscountBp: true,
      needsApproval: true,
      approvedAt: true,
      approvalRequestedAt: true,
      confirmedAt: true,
      expectedMonthlyOrders: true,
      deal: {
        select: {
          id: true,
          number: true,
          ownerId: true,
          owner: { select: { name: true } },
          company: { select: { brandName: true } },
        },
      },
    },
    orderBy: { number: 'desc' },
    take: LIST_MAX_ROWS,
  });
  return rows.map((p) => {
    const createdDay = cairoDay(p.createdAt);
    return {
      id: p.id,
      number: proposalNumber(p.number),
      numberValue: p.number,
      version: p.version,
      dealId: p.deal.id,
      deal: dealNumber(p.deal.number),
      company: p.deal.company.brandName,
      status: p.status,
      ownerId: p.deal.ownerId,
      owner: p.deal.owner?.name ?? null,
      createdAt: p.createdAt.toISOString(),
      createdDay,
      month: monthOfDay(createdDay),
      sentAt: p.sentAt?.toISOString() ?? null,
      validUntil: p.validUntil?.toISOString().slice(0, 10) ?? null,
      acceptedAt: p.acceptedAt?.toISOString() ?? null,
      discount: p.maxDiscountBp,
      discountOverLimit: p.needsApproval,
      toApprove:
        p.status === 'draft' && p.needsApproval && !p.approvedAt && !!p.approvalRequestedAt,
      confirmed: !!p.confirmedAt,
      expectedOrders: p.expectedMonthlyOrders,
    };
  });
}

const proposals: ListDef<ProposalListRow> = {
  id: 'proposals',
  filters: {
    ...statusFilter<ProposalListRow>(PROPOSAL_LIST_STATUSES),
    to_approve: { group: 'approval', test: (r) => r.toApprove },
    discount_over_limit: { group: 'approval', test: (r) => r.discountOverLimit },
    confirmed: { group: 'confirmed', test: (r) => r.confirmed },
    this_month: dayFilters<ProposalListRow>((r) => r.createdDay).this_month,
    last_month: dayFilters<ProposalListRow>((r) => r.createdDay).last_month,
  },
  values: { owner: (r, v) => r.ownerId === v },
  groupBys: {
    status: (r) => named(r.status, r.status),
    owner: (r) => named(r.ownerId, r.owner),
    month: (r) => named(r.month, r.month),
  },
  search: (r) => [r.number, String(r.numberValue), r.deal, r.company, r.owner],
  sorts: {
    number: (r) => r.numberValue,
    created: (r) => r.createdAt,
    discount: (r) => r.discount,
  },
  defaultSort: { key: 'number', desc: true },
  sums: APP_LISTS.sales.proposals.sums,
};

// HR: rows belong to the person's home store; someone limited to some stores sees only those.

const hrStoreWhere = (scope: ListScope, chosen?: string) =>
  scope.storeIds === null
    ? chosen
      ? { homeStoreId: chosen }
      : {}
    : { homeStoreId: within(chosen, scope.storeIds) };

/** Every department's chain up to the top (itself first), for "this department and below". */
async function departmentChains(db: Db) {
  const rows = await db.department.findMany({ select: { id: true, parentId: true } });
  const parent = new Map(rows.map((d) => [d.id, d.parentId]));
  const chain = (id: string | null) => {
    const out: string[] = [];
    for (let d = id, i = 0; d && i < 50; d = parent.get(d) ?? null, i++) out.push(d);
    return out;
  };
  return chain;
}

export interface EmployeeListRow2 {
  id: string;
  code: string;
  numberValue: number;
  nameEn: string;
  nameAr: string | null;
  mobile: string | null;
  email: string | null;
  jobTitle: string | null;
  departmentId: string | null;
  departmentPath: string[];
  department: string | null;
  departmentAr: string | null;
  positionId: string | null;
  position: string | null;
  positionAr: string | null;
  gradeId: string | null;
  storeId: string | null;
  store: string | null;
  managerId: string | null;
  manager: string | null;
  employment: string;
  payBasis: string;
  status: string;
  hireDate: string | null;
  probationEndsOn: string | null;
  documents: number;
  missingDocuments: number;
  openViolations: number;
  flags: string[];
  /** Only for people with HR use (searched, never shown in the list) */
  nationalId?: string | null;
}

async function loadEmployees(
  db: Db,
  scope: ListScope,
  state: ListState,
  now: Date,
): Promise<EmployeeListRow2[]> {
  const [{ rows }, chain, numbers] = await Promise.all([
    employeeDirectory(
      db,
      {
        scope: scope.storeIds,
        storeId: state.values.store,
        positionId: state.values.position,
        pageSize: null,
      },
      now,
    ),
    departmentChains(db),
    db.employee.findMany({
      where: hrStoreWhere(scope),
      select: { id: true, number: true },
    }),
  ]);
  const confidential = canDo(scope.access, 'hr', 'use');
  const number = new Map(numbers.map((e) => [e.id, e.number]));
  return rows.map((e) => ({
    id: e.id,
    code: e.code,
    numberValue: number.get(e.id) ?? 0,
    nameEn: e.nameEn,
    // Arabic screens show the English name when the Arabic one was never typed.
    nameAr: e.nameAr || e.nameEn,
    mobile: e.mobile,
    email: e.user.email,
    jobTitle: e.jobTitle,
    departmentId: e.department?.id ?? null,
    departmentPath: chain(e.department?.id ?? null),
    department: e.department?.nameEn ?? null,
    departmentAr: e.department?.nameAr ?? null,
    positionId: e.position?.id ?? null,
    position: e.position?.titleEn ?? e.jobTitle ?? null,
    positionAr: e.position?.titleAr ?? e.jobTitle ?? null,
    gradeId: e.grade?.id ?? null,
    storeId: e.homeStore?.id ?? null,
    store: e.homeStore?.code ?? null,
    managerId: e.manager?.id ?? null,
    manager: e.manager?.nameEn ?? null,
    employment: e.employment,
    payBasis: e.payBasis,
    status: e.status,
    hireDate: e.hireDate,
    probationEndsOn: e.probationEndsOn,
    documents: e.documents.percent,
    missingDocuments: e.documents.missing,
    openViolations: e.openViolations,
    flags: e.flags,
    ...(confidential && { nationalId: e.nationalId }),
  }));
}

const employees: ListDef<EmployeeListRow2> = {
  id: 'employees',
  filters: {
    ...Object.fromEntries(
      EMPLOYEE_LIST_FLAGS.map((f) => [
        f,
        { group: 'flag', test: (r: EmployeeListRow2) => r.flags.includes(f) },
      ]),
    ),
    current: { group: 'status', test: (r) => r.status !== 'left' },
    active: { group: 'status', test: (r) => r.status === 'active' },
    on_leave: { group: 'status', test: (r) => r.status === 'on_leave' },
    suspended: { group: 'status', test: (r) => r.status === 'suspended' },
    employee: { group: 'employment', test: (r) => r.employment === 'employee' },
    outsourced: { group: 'employment', test: (r) => r.employment === 'outsourced' },
    monthly_salary: { group: 'pay', test: (r) => r.payBasis === 'monthly_salary' },
    per_delivery: { group: 'pay', test: (r) => r.payBasis === 'per_delivery' },
  },
  values: {
    department: (r, v) => r.departmentPath.includes(v),
    position: (r, v) => r.positionId === v,
    grade: (r, v) => r.gradeId === v,
    store: (r, v) => r.storeId === v,
  },
  groupBys: {
    department: (r) => named(r.departmentId, r.department),
    store: (r) => named(r.storeId, r.store),
    position: (r) => named(r.positionId, r.position),
    employment: (r) => named(r.employment, r.employment),
    status: (r) => named(r.status, r.status),
    manager: (r) => named(r.managerId, r.manager),
  },
  search: (r) => [
    r.nameEn,
    r.nameAr,
    r.code,
    String(r.numberValue),
    r.mobile,
    r.mobile ? localPhone(r.mobile) : null,
    r.email,
    r.jobTitle,
    r.nationalId,
  ],
  sorts: {
    name: (r) => r.nameEn.toLowerCase(),
    code: (r) => r.numberValue,
    hired: (r) => r.hireDate,
    documents: (r) => r.documents,
    department: (r) => r.department?.toLowerCase() ?? null,
    store: (r) => r.store,
  },
  defaultSort: { key: 'name', desc: false },
  sums: APP_LISTS.hr.employees.sums,
};

export interface LeaveListRow {
  id: string;
  number: string;
  numberValue: number;
  employeeId: string;
  employee: string;
  employeeAr: string | null;
  employeeCode: string;
  storeId: string | null;
  store: string | null;
  departmentId: string | null;
  department: string | null;
  typeId: string;
  type: string;
  typeAr: string;
  from: string;
  to: string;
  days: number;
  status: string;
  createdAt: string;
  month: string;
  waitingForMe: boolean;
  hasDocument: boolean;
}

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const atDay = (d: string) => new Date(`${d}T00:00:00Z`);

async function loadLeave(db: Db, scope: ListScope, state: ListState): Promise<LeaveListRow[]> {
  const { from, to, type, department, store } = state.values;
  const rows = await db.leaveRequest.findMany({
    where: {
      ...(type && { typeId: type }),
      // Requests that touch the chosen days.
      ...(from && { toDay: { gte: atDay(from) } }),
      ...(to && { fromDay: { lte: atDay(to) } }),
      employee: {
        ...hrStoreWhere(scope, store),
        ...(department && { departmentId: department }),
      },
    },
    select: {
      id: true,
      number: true,
      fromDay: true,
      toDay: true,
      days: true,
      status: true,
      createdAt: true,
      documentContentType: true,
      type: { select: { id: true, nameEn: true, nameAr: true } },
      employee: {
        select: {
          id: true,
          number: true,
          userId: true,
          nameEn: true,
          nameAr: true,
          homeStore: { select: { id: true, code: true } },
          department: { select: { id: true, nameEn: true } },
        },
      },
    },
    orderBy: [{ fromDay: 'desc' }, { number: 'desc' }],
    take: LIST_MAX_ROWS,
  });
  // What waits for me: my direct reports at the manager step; with HR use, the HR step.
  const me = await db.employee.findUnique({
    where: { userId: scope.userId },
    select: { id: true },
  });
  const reports = new Set(me ? await directReports(db, me.id) : []);
  const hrUse = canDo(scope.access, 'hr', 'use');
  return rows.map((r) => {
    const mine = r.employee.userId === scope.userId;
    return {
      id: r.id,
      number: leaveRequestNumber(r.number),
      numberValue: r.number,
      employeeId: r.employee.id,
      employee: r.employee.nameEn,
      employeeAr: r.employee.nameAr || r.employee.nameEn,
      employeeCode: employeeCode(r.employee.number),
      storeId: r.employee.homeStore?.id ?? null,
      store: r.employee.homeStore?.code ?? null,
      departmentId: r.employee.department?.id ?? null,
      department: r.employee.department?.nameEn ?? null,
      typeId: r.type.id,
      type: r.type.nameEn,
      typeAr: r.type.nameAr,
      from: dayOf(r.fromDay),
      to: dayOf(r.toDay),
      days: Number(r.days),
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      month: monthOfDay(dayOf(r.fromDay)),
      waitingForMe:
        !mine &&
        ((r.status === 'pending_manager' && reports.has(r.employee.id)) ||
          (r.status === 'pending_hr' && hrUse)),
      hasDocument: !!r.documentContentType,
    };
  });
}

const leave: ListDef<LeaveListRow> = {
  id: 'leave',
  filters: {
    pending: {
      group: 'status',
      test: (r) => r.status === 'pending_manager' || r.status === 'pending_hr',
    },
    ...statusFilter<LeaveListRow>(LEAVE_LIST_STATUSES),
    waiting_for_me: { group: 'mine', test: (r) => r.waitingForMe },
    today: { group: 'date', test: (r, ctx) => r.from <= ctx.today && r.to >= ctx.today },
    this_month: {
      group: 'date',
      test: (r, ctx) =>
        monthOfDay(r.from) <= monthOfDay(ctx.today) && monthOfDay(r.to) >= monthOfDay(ctx.today),
    },
    last_month: {
      group: 'date',
      test: (r, ctx) => {
        const m = previousMonth(monthOfDay(ctx.today));
        return monthOfDay(r.from) <= m && monthOfDay(r.to) >= m;
      },
    },
    upcoming: { group: 'date', test: (r, ctx) => r.from > ctx.today },
  },
  values: {
    type: (r, v) => r.typeId === v,
    store: (r, v) => r.storeId === v,
    department: (r, v) => r.departmentId === v,
    from: (r, v) => r.to >= v,
    to: (r, v) => r.from <= v,
  },
  groupBys: {
    status: (r) => named(r.status, r.status),
    type: (r) => named(r.typeId, r.type),
    employee: (r) => named(r.employeeId, r.employee),
    store: (r) => named(r.storeId, r.store),
    department: (r) => named(r.departmentId, r.department),
    month: (r) => named(r.month, r.month),
  },
  search: (r) => [
    r.number,
    String(r.numberValue),
    r.employee,
    r.employeeAr,
    r.employeeCode,
    r.type,
    r.typeAr,
  ],
  sorts: {
    number: (r) => r.numberValue,
    from: (r) => r.from,
    days: (r) => r.days,
    created: (r) => r.createdAt,
  },
  defaultSort: { key: 'from', desc: true },
  sums: APP_LISTS.hr.leave.sums,
};

export interface ViolationListRow {
  id: string;
  number: string;
  numberValue: number;
  employeeId: string;
  employee: string;
  employeeAr: string | null;
  employeeCode: string;
  employment: string;
  storeId: string | null;
  store: string | null;
  typeId: string;
  type: string;
  typeAr: string;
  occurredOn: string;
  month: string;
  step: number;
  penalty: string;
  days: number | null;
  /** A fixed amount of the ladder (deduction_amount); days of pay are never shown here */
  amount: number | null;
  status: string;
  forSupplier: boolean;
}

async function loadViolations(
  db: Db,
  scope: ListScope,
  state: ListState,
): Promise<ViolationListRow[]> {
  const { from, to, type, store } = state.values;
  const rows = await db.violation.findMany({
    where: {
      ...(type && { typeId: type }),
      ...((from || to) && {
        occurredOn: { ...(from && { gte: atDay(from) }), ...(to && { lte: atDay(to) }) },
      }),
      employee: hrStoreWhere(scope, store),
    },
    select: {
      id: true,
      number: true,
      occurredOn: true,
      step: true,
      penalty: true,
      days: true,
      amountPiastres: true,
      status: true,
      type: { select: { id: true, nameEn: true, nameAr: true } },
      employee: {
        select: {
          id: true,
          number: true,
          nameEn: true,
          nameAr: true,
          employment: true,
          payBasis: true,
          homeStore: { select: { id: true, code: true } },
        },
      },
    },
    orderBy: [{ occurredOn: 'desc' }, { number: 'desc' }],
    take: LIST_MAX_ROWS,
  });
  return rows.map((v) => {
    const occurredOn = dayOf(v.occurredOn);
    return {
      id: v.id,
      number: violationNumber(v.number),
      numberValue: v.number,
      employeeId: v.employee.id,
      employee: v.employee.nameEn,
      employeeAr: v.employee.nameAr || v.employee.nameEn,
      employeeCode: employeeCode(v.employee.number),
      employment: v.employee.employment,
      storeId: v.employee.homeStore?.id ?? null,
      store: v.employee.homeStore?.code ?? null,
      typeId: v.type.id,
      type: v.type.nameEn,
      typeAr: v.type.nameAr,
      occurredOn,
      month: monthOfDay(occurredOn),
      step: v.step,
      penalty: v.penalty,
      days: v.days === null ? null : Number(v.days),
      amount: v.amountPiastres,
      status: v.status,
      forSupplier:
        v.employee.employment === 'outsourced' &&
        v.employee.payBasis !== 'per_delivery' &&
        v.status === 'final' &&
        (v.penalty === 'deduction_days' || v.penalty === 'deduction_amount'),
    };
  });
}

const violations: ListDef<ViolationListRow> = {
  id: 'violations',
  filters: {
    open: { group: 'status', test: (r) => r.status === 'recorded' || r.status === 'appealed' },
    ...statusFilter<ViolationListRow>(VIOLATION_LIST_STATUSES),
    ...statusFilterOn<ViolationListRow>('penalty', VIOLATION_LIST_PENALTIES, (r) => r.penalty),
    for_supplier: { group: 'supplier', test: (r) => r.forSupplier },
    employee: { group: 'employment', test: (r) => r.employment === 'employee' },
    outsourced: { group: 'employment', test: (r) => r.employment === 'outsourced' },
    ...dayFilters<ViolationListRow>((r) => r.occurredOn),
  },
  values: {
    type: (r, v) => r.typeId === v,
    store: (r, v) => r.storeId === v,
    from: (r, v) => r.occurredOn >= v,
    to: (r, v) => r.occurredOn <= v,
  },
  groupBys: {
    status: (r) => named(r.status, r.status),
    type: (r) => named(r.typeId, r.type),
    employee: (r) => named(r.employeeId, r.employee),
    store: (r) => named(r.storeId, r.store),
    penalty: (r) => named(r.penalty, r.penalty),
    month: (r) => named(r.month, r.month),
  },
  search: (r) => [
    r.number,
    String(r.numberValue),
    r.employee,
    r.employeeAr,
    r.employeeCode,
    r.type,
    r.typeAr,
  ],
  sorts: {
    number: (r) => r.numberValue,
    occurred: (r) => r.occurredOn,
    amount: (r) => r.amount,
  },
  defaultSort: { key: 'occurred', desc: true },
  sums: APP_LISTS.hr.violations.sums,
};

export interface SuggestionListRow {
  id: string;
  day: string;
  kind: string;
  lateMinutes: number;
  status: string;
  employeeId: string;
  employee: string;
  employeeAr: string | null;
  employeeCode: string;
  storeId: string | null;
  store: string | null;
  type: string | null;
  typeAr: string | null;
  violationId: string | null;
  violation: string | null;
}

async function loadSuggestions(
  db: Db,
  scope: ListScope,
  state: ListState,
): Promise<SuggestionListRow[]> {
  const rows = await db.violationSuggestion.findMany({
    where: { employee: hrStoreWhere(scope, state.values.store) },
    select: {
      id: true,
      day: true,
      kind: true,
      lateMinutes: true,
      status: true,
      type: { select: { nameEn: true, nameAr: true } },
      violation: { select: { id: true, number: true } },
      employee: {
        select: {
          id: true,
          number: true,
          nameEn: true,
          nameAr: true,
          homeStore: { select: { id: true, code: true } },
        },
      },
    },
    orderBy: [{ day: 'desc' }, { createdAt: 'desc' }],
    take: LIST_MAX_ROWS,
  });
  return rows.map((s) => ({
    id: s.id,
    day: dayOf(s.day),
    kind: s.kind,
    lateMinutes: s.lateMinutes,
    status: s.status,
    employeeId: s.employee.id,
    employee: s.employee.nameEn,
    employeeAr: s.employee.nameAr || s.employee.nameEn,
    employeeCode: employeeCode(s.employee.number),
    storeId: s.employee.homeStore?.id ?? null,
    store: s.employee.homeStore?.code ?? null,
    type: s.type?.nameEn ?? null,
    typeAr: s.type?.nameAr ?? null,
    violationId: s.violation?.id ?? null,
    violation: s.violation ? violationNumber(s.violation.number) : null,
  }));
}

const suggestions: ListDef<SuggestionListRow> = {
  id: 'suggestions',
  filters: {
    ...statusFilter<SuggestionListRow>(SUGGESTION_LIST_STATUSES),
    late: { group: 'kind', test: (r) => r.kind === 'late' },
    absent: { group: 'kind', test: (r) => r.kind === 'absent' },
    ...dayFilters<SuggestionListRow>((r) => r.day),
  },
  values: { store: (r, v) => r.storeId === v },
  groupBys: {
    kind: (r) => named(r.kind, r.kind),
    store: (r) => named(r.storeId, r.store),
    day: (r) => named(r.day, r.day),
    employee: (r) => named(r.employeeId, r.employee),
  },
  search: (r) => [r.employee, r.employeeAr, r.employeeCode, r.type, r.typeAr, r.violation],
  sorts: { day: (r) => r.day, lateMinutes: (r) => r.lateMinutes },
  defaultSort: { key: 'day', desc: true },
  sums: APP_LISTS.hr.suggestions.sums,
};

// ─── Accounting: Basata cash deposits ───────────────────────────────────────────

export interface BasataDepositListRow {
  id: string;
  number: string;
  status: string;
  riderId: string;
  rider: string;
  badge: string;
  storeId: string;
  store: string;
  amount: number;
  reference: string;
  depositedAt: string;
  depositedDay: string;
  createdAt: string;
  createdDay: string;
  /** Sent after the deadline of the day the cash was deposited */
  late: boolean;
  decidedBy: string | null;
  decidedAt: string | null;
  rejectReason: string | null;
  settlementId: string | null;
  settlement: string | null;
}

async function loadBasataDeposits(
  db: Db,
  scope: ListScope,
  state: ListState,
): Promise<BasataDepositListRow[]> {
  const rows = await db.basataDeposit.findMany({
    where: {
      darkStoreId: within(state.values.store, scope.storeIds),
      ...(state.values.rider && { riderId: state.values.rider }),
      depositedAt: dayRange(state),
    },
    include: {
      rider: { select: { badgeCode: true, user: { select: { name: true } } } },
      darkStore: storeRef,
      decidedBy: { select: { name: true } },
      settlement: { select: { number: true } },
    },
    orderBy: { number: 'desc' },
    take: LIST_MAX_ROWS,
  });
  return rows.map((d) => ({
    id: d.id,
    number: basataDepositNumber(d.number),
    status: d.status,
    riderId: d.riderId,
    rider: d.rider.user.name,
    badge: d.rider.badgeCode,
    storeId: d.darkStoreId,
    store: d.darkStore.code,
    amount: d.amountPiastres,
    reference: d.reference,
    depositedAt: d.depositedAt.toISOString(),
    depositedDay: cairoDay(d.depositedAt),
    createdAt: d.createdAt.toISOString(),
    createdDay: cairoDay(d.createdAt),
    late: d.deadlineDay.toISOString().slice(0, 10) > cairoDay(d.depositedAt),
    decidedBy: d.decidedBy?.name ?? null,
    decidedAt: d.decidedAt?.toISOString() ?? null,
    rejectReason: d.rejectReason,
    settlementId: d.settlementId,
    settlement: d.settlement ? basataSettlementNumber(d.settlement.number) : null,
  }));
}

const basataDeposits: ListDef<BasataDepositListRow> = {
  id: 'basata_deposits',
  filters: {
    ...statusFilter<BasataDepositListRow>(['pending', 'approved', 'rejected']),
    not_settled: {
      group: 'settled',
      test: (r) => r.status === 'approved' && r.settlementId === null,
    },
    settled: { group: 'settled', test: (r) => r.settlementId !== null },
    late: { group: 'timing', test: (r) => r.late },
    ...dayFilters<BasataDepositListRow>((r) => r.depositedDay),
  },
  values: {
    store: (r, v) => r.storeId === v,
    rider: (r, v) => r.riderId === v,
    from: (r, v) => r.depositedDay >= v,
    to: (r, v) => r.depositedDay <= v,
  },
  groupBys: {
    status: (r) => named(r.status, r.status),
    store: (r) => named(r.storeId, r.store),
    rider: (r) => named(r.riderId, `${r.rider} (${r.badge})`),
    day: (r) => named(r.depositedDay, r.depositedDay),
    settlement: (r) => named(r.settlementId, r.settlement),
  },
  search: (r) => [r.number, r.rider, r.badge, r.reference, r.store, r.settlement],
  sorts: {
    number: (r) => r.number,
    deposited: (r) => r.depositedAt,
    created: (r) => r.createdAt,
    amount: (r) => r.amount,
  },
  defaultSort: { key: 'number', desc: true },
  sums: APP_LISTS.accounting.basata_deposits.sums,
};

// ─── the registry ───────────────────────────────────────────────────────────────

export const APP_LIST_DEFS: Record<string, Record<string, RegisteredList>> = {
  operations: {
    orders: { def: orders, load: loadOrders },
    alerts: { def: alerts, load: loadAlerts },
  },
  inventory: {
    stock: { def: stock, load: loadStock },
    shipments: { def: shipments, load: loadShipments },
    transfers: { def: transfers, load: loadTransfers },
    returns: { def: returns, load: loadReturns },
    counts: { def: counts, load: loadCounts },
    damage: { def: damage, load: loadDamage },
  },
  merchants: {
    merchants: { def: merchants, load: loadMerchants },
    products: { def: products, load: loadProducts },
  },
  customers: {
    customers: { def: customers, load: loadCustomers },
  },
  sales: {
    deals: { def: deals, load: loadDeals },
    companies: { def: companies, load: loadCompanies },
    proposals: { def: proposals, load: loadProposals },
  },
  hr: {
    employees: { def: employees, load: loadEmployees },
    leave: { def: leave, load: loadLeave },
    violations: { def: violations, load: loadViolations },
    suggestions: { def: suggestions, load: loadSuggestions },
  },
  accounting: {
    basata_deposits: { def: basataDeposits, load: loadBasataDeposits },
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
  const locations = ['store', 'sender', 'receiver', 'destination'].filter((k) => wants.includes(k));
  if (locations.length) {
    const stores = await db.darkStore.findMany({
      where: { id: storeIn(scope), ...(id === 'orders' && { kind: 'dark_store' }) },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { code: 'asc' },
    });
    const options = stores.map((s) => ({
      value: s.id,
      label: `${s.code} · ${s.nameEn}`,
      labelAr: `${s.code} · ${s.nameAr}`,
    }));
    for (const k of locations) out[k] = options;
  }
  if (wants.includes('rider')) {
    // The riders of the person's stores.
    const riders = await db.rider.findMany({
      where: { darkStoreId: storeIn(scope) },
      select: { id: true, badgeCode: true, user: { select: { name: true } } },
      orderBy: { badgeCode: 'asc' },
    });
    out.rider = riders.map((r) => ({ value: r.id, label: `${r.user.name} (${r.badgeCode})` }));
  }
  if (wants.includes('merchant')) {
    const merchants = await db.merchant.findMany({
      where: { id: merchantIn(scope) },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    out.merchant = merchants.map((m) => ({ value: m.id, label: m.name }));
  }
  if (wants.includes('manager')) {
    // The account managers of the merchants the person may see.
    const managers = await db.user.findMany({
      where: { merchantsManaged: { some: { id: merchantIn(scope) } } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    out.manager = managers.map((u) => ({ value: u.id, label: u.name }));
  }
  if (wants.includes('district')) {
    const districts = await db.geoArea.findMany({
      where: { customers: { some: {} } },
      select: { id: true, nameEn: true, nameAr: true },
      orderBy: { nameEn: 'asc' },
    });
    out.district = districts.map((d) => ({ value: d.id, label: d.nameEn, labelAr: d.nameAr }));
  }
  if (app === 'sales' && wants.includes('owner')) {
    // The sales people; a rep with own deals only picks only themselves.
    const actor = salesActor(scope);
    const people = await salesPeople(db);
    out.owner = people
      .filter((p) => !actor.ownOnly || p.id === scope.userId)
      .map((p) => ({ value: p.id, label: p.name }));
  }
  if (app === 'hr') {
    if (wants.includes('department')) {
      const rows = await db.department.findMany({
        select: { id: true, nameEn: true, nameAr: true },
        orderBy: { nameEn: 'asc' },
      });
      out.department = rows.map((d) => ({ value: d.id, label: d.nameEn, labelAr: d.nameAr }));
    }
    if (wants.includes('position')) {
      const rows = await db.jobPosition.findMany({
        select: { id: true, titleEn: true, titleAr: true },
        orderBy: { titleEn: 'asc' },
      });
      out.position = rows.map((p) => ({ value: p.id, label: p.titleEn, labelAr: p.titleAr }));
    }
    if (wants.includes('grade')) {
      const rows = await db.grade.findMany({
        select: { id: true, code: true, nameEn: true, nameAr: true },
        orderBy: { rank: 'asc' },
      });
      out.grade = rows.map((g) => ({
        value: g.id,
        label: `${g.code} · ${g.nameEn}`,
        labelAr: `${g.code} · ${g.nameAr}`,
      }));
    }
    if (wants.includes('type')) {
      const rows =
        id === 'leave'
          ? await db.leaveType.findMany({
              select: { id: true, nameEn: true, nameAr: true },
              orderBy: { sort: 'asc' },
            })
          : await db.violationType.findMany({
              select: { id: true, nameEn: true, nameAr: true },
              orderBy: { nameEn: 'asc' },
            });
      out.type = rows.map((x) => ({ value: x.id, label: x.nameEn, labelAr: x.nameAr }));
    }
    return out;
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
