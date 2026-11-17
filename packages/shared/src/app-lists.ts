import { z } from 'zod';
import type { AccessApp } from './access';
import { bulkIdsSchema, type ListMeta, listKnownOf } from './list-view';

// The list views of the other apps (UX phase C), keyed by app and list: GET /lists/<app>/<id>
// answers them (view on the app, rows inside the person's stores and merchants). Like
// FINANCE_LISTS, each names its predefined filters (key → the group they OR within), value
// filters, groupings, sortable columns, summed money columns and default filters; the API's
// definitions (packages/db/src/app-lists.ts) implement exactly these keys (appListGaps).

const days = {
  today: 'date',
  yesterday: 'date',
  last_7_days: 'date',
  this_month: 'date',
  last_month: 'date',
} as const;

/** The order statuses as filters, plus "in progress" (anything not finished). */
export const ORDER_LIST_STATUSES = [
  'new',
  'accepted',
  'picking',
  'packed',
  'out_for_delivery',
  'attempt_failed',
  'delivered',
  'cancelled',
  'failed',
  'moved_to_standard',
] as const;

export const DAMAGE_LIST_CAUSES = [
  'arrived_damaged',
  'store_handling',
  'delivery',
  'customer',
  'expired',
] as const;

/** Inventory documents' statuses as filters (each list adds "open": not finished yet). */
export const SHIPMENT_LIST_STATUSES = ['expected', 'receiving', 'received', 'cancelled'] as const;
export const TRANSFER_LIST_STATUSES = [
  'draft',
  'approved',
  'picking',
  'in_transit',
  'received',
  'cancelled',
] as const;
export const RETURN_LIST_STATUSES = [
  'requested',
  'picking',
  'ready',
  'collected',
  'cancelled',
] as const;
export const COUNT_LIST_STATUSES = ['submitted', 'approved', 'rejected', 'stale'] as const;

/** Customer segments (customer.* settings decide who falls in which) and cash risk levels. */
export const CUSTOMER_LIST_SEGMENTS = [
  'new',
  'vip',
  'loyal',
  'one_time',
  'at_risk',
  'lost',
  'no_orders',
] as const;
export const CUSTOMER_LIST_RISKS = ['high', 'medium', 'low', 'unknown'] as const;

/** Sales CRM (UX phase C step 4): deal stages, lead sources and proposal statuses. */
export const DEAL_LIST_STAGES = [
  'new',
  'contacted',
  'meeting',
  'proposal',
  'negotiation',
  'won',
  'lost',
] as const;
export const DEAL_LIST_SOURCES = [
  'website_form',
  'signup',
  'manual',
  'referral',
  'event',
  'other',
] as const;
export const PROPOSAL_LIST_STATUSES = [
  'draft',
  'sent',
  'viewed',
  'accepted',
  'declined',
  'expired',
  'superseded',
] as const;

/** HR (UX phase C step 4): file flags, leave and violation statuses, penalties. */
export const EMPLOYEE_LIST_FLAGS = [
  'missing_documents',
  'on_probation',
  'leaving',
  'left',
  'on_leave_today',
  'open_violations',
] as const;
export const LEAVE_LIST_STATUSES = [
  'pending_manager',
  'pending_hr',
  'approved',
  'rejected',
  'cancelled',
] as const;
export const VIOLATION_LIST_STATUSES = ['recorded', 'appealed', 'final', 'cancelled'] as const;
export const VIOLATION_LIST_PENALTIES = [
  'verbal_warning',
  'written_warning',
  'deduction_days',
  'deduction_amount',
  'suspension_days',
  'termination_review',
] as const;
export const SUGGESTION_LIST_STATUSES = ['open', 'confirmed', 'dismissed'] as const;

const statusFilters = <S extends readonly string[]>(statuses: S) =>
  Object.fromEntries(statuses.map((s) => [s, 'status'])) as Record<S[number], 'status'>;
/** The values of a list as filters of one named group. */
const statusFilterOn = <G extends string, S extends readonly string[]>(group: G, values: S) =>
  Object.fromEntries(values.map((s) => [s, group])) as Record<S[number], G>;

export const APP_LISTS = {
  operations: {
    orders: {
      filters: {
        active: 'status',
        ...Object.fromEntries(ORDER_LIST_STATUSES.map((s) => [s, 'status'])),
        late_now: 'late',
        was_late: 'late',
        delivered_late: 'late',
        cod: 'payment',
        prepaid: 'payment',
        shopify: 'source',
        manual: 'source',
        phone_flagged: 'flags',
        ...days,
      },
      values: { store: 'option', merchant: 'option', from: 'day_from', to: 'day_to' },
      groupBys: ['store', 'status', 'merchant', 'day', 'payment', 'source'],
      sorts: ['number', 'placed', 'promise', 'cod', 'value'],
      sums: ['cod', 'value', 'deliveryFee'],
      defaultFilters: [],
    },
    alerts: {
      filters: {
        open: 'status',
        handled: 'status',
        with_order: 'order',
        today: 'date',
        last_7_days: 'date',
        this_month: 'date',
      },
      values: { type: 'option', store: 'option' },
      groupBys: ['type', 'store', 'day'],
      sorts: ['created', 'type'],
      sums: [],
      defaultFilters: ['open'],
    },
  },
  inventory: {
    // UX phase C step 2: stock, shipments in, transfers, returns to merchants and counts.
    stock: {
      filters: {
        in_stock: 'level',
        low_stock: 'level',
        out_of_stock: 'level',
        has_reserved: 'reserved',
        dark_stores: 'kind',
        hubs: 'kind',
      },
      values: { store: 'option', merchant: 'option' },
      groupBys: ['store', 'merchant', 'product'],
      sorts: ['sku', 'onHand', 'reserved', 'available'],
      sums: ['onHand', 'reserved', 'available'],
      defaultFilters: [],
    },
    shipments: {
      filters: {
        open: 'status',
        ...statusFilters(SHIPMENT_LIST_STATUSES),
        extra: 'difference',
        short: 'difference',
        to_hub: 'kind',
        to_store: 'kind',
        ...days,
      },
      values: { store: 'option', merchant: 'option', from: 'day_from', to: 'day_to' },
      groupBys: ['status', 'store', 'merchant', 'day', 'month'],
      sorts: ['reference', 'created', 'expectedUnits', 'receivedUnits'],
      sums: ['expectedUnits', 'receivedUnits', 'extraUnits', 'shortUnits'],
      defaultFilters: [],
    },
    transfers: {
      filters: {
        open: 'status',
        ...statusFilters(TRANSFER_LIST_STATUSES),
        manual: 'origin',
        refill: 'origin',
        short_sent: 'short',
        short_received: 'short',
        via_hub: 'leg',
        ...days,
      },
      values: {
        store: 'option',
        sender: 'option',
        receiver: 'option',
        destination: 'option',
        from: 'day_from',
        to: 'day_to',
      },
      groupBys: ['status', 'sender', 'receiver', 'destination', 'origin', 'day'],
      sorts: ['reference', 'created', 'units'],
      sums: ['units', 'pickedUnits', 'receivedUnits'],
      defaultFilters: [],
    },
    returns: {
      filters: {
        open: 'status',
        ...statusFilters(RETURN_LIST_STATUSES),
        sellable: 'source',
        damaged: 'source',
        held: 'source',
        ...days,
      },
      values: { store: 'option', merchant: 'option', from: 'day_from', to: 'day_to' },
      groupBys: ['status', 'store', 'merchant', 'day'],
      sorts: ['reference', 'created', 'units'],
      sums: ['units', 'pickedUnits'],
      defaultFilters: [],
    },
    counts: {
      filters: {
        ...statusFilters(COUNT_LIST_STATUSES),
        with_differences: 'difference',
        no_differences: 'difference',
        ...days,
      },
      values: { store: 'option', from: 'day_from', to: 'day_to' },
      groupBys: ['status', 'store', 'day'],
      sorts: ['created', 'differences'],
      sums: ['differences', 'netDifference'],
      defaultFilters: ['submitted'],
    },
    damage: {
      filters: {
        pending: 'status',
        settled: 'status',
        ...Object.fromEntries(DAMAGE_LIST_CAUSES.map((c) => [c, 'cause'])),
        company_pays: 'who_pays',
        last_7_days: 'date',
        this_month: 'date',
        last_month: 'date',
      },
      values: { store: 'option', merchant: 'option' },
      groupBys: ['cause', 'store', 'merchant', 'status', 'month'],
      sorts: ['created', 'quantity', 'value'],
      sums: ['value', 'compensation', 'riderCharge'],
      defaultFilters: ['pending'],
    },
  },
  // UX phase C step 3: merchants and their products (Merchants app), customer profiles
  // (Customers app, customer data only).
  merchants: {
    merchants: {
      filters: {
        active: 'state',
        paused: 'state',
        pending: 'approval',
        approved: 'approval',
        rejected: 'approval',
        shopify_connected: 'shopify',
        shopify_not_connected: 'shopify',
        express_on: 'express',
        express_off: 'express',
        contract_in_force: 'contract',
        no_contract: 'contract',
        debit_wallet: 'wallet',
        owed_money: 'wallet',
        no_manager: 'manager',
      },
      values: { manager: 'option' },
      groupBys: ['approval', 'manager', 'schedule', 'state'],
      sorts: ['name', 'created', 'orders30', 'skus', 'balance'],
      sums: ['orders30', 'skus', 'balance'],
      defaultFilters: [],
    },
    products: {
      filters: {
        active: 'state',
        inactive: 'state',
        linked: 'shopify',
        not_linked: 'shopify',
        in_stock: 'stock',
        out_of_stock: 'stock',
        no_barcode: 'barcode',
      },
      values: { merchant: 'option' },
      groupBys: ['merchant', 'state', 'shopify'],
      sorts: ['sku', 'title', 'price', 'onHand', 'available'],
      sums: ['onHand', 'reserved', 'available'],
      defaultFilters: [],
    },
  },
  customers: {
    customers: {
      filters: {
        ...Object.fromEntries(CUSTOMER_LIST_SEGMENTS.map((s) => [s, 'segment'])),
        ...Object.fromEntries(CUSTOMER_LIST_RISKS.map((r) => [`risk_${r}`, 'risk'])),
        due_to_reorder: 'due',
        with_phone: 'contact',
        with_email: 'contact',
        several_merchants: 'merchants',
      },
      values: { merchant: 'option', district: 'option' },
      groupBys: ['segment', 'district', 'governorate', 'merchant', 'risk'],
      sorts: ['name', 'orders', 'spend', 'last'],
      sums: ['orders', 'spend'],
      defaultFilters: [],
    },
  },
  // UX phase C step 4: the Sales CRM (deals, companies, proposals; own_deals_only keeps a rep
  // to their own) and HR (employees, leave requests, violations and the suggestions of the
  // attendance close; rows inside the person's stores).
  sales: {
    deals: {
      filters: {
        open_deals: 'stage',
        ...statusFilterOn('stage', DEAL_LIST_STAGES),
        mine: 'owner',
        unassigned: 'owner',
        followup_overdue: 'followup',
        no_next_step: 'followup',
        stale: 'stale',
        ...statusFilterOn('source', DEAL_LIST_SOURCES),
        proposal_sent: 'proposal',
        proposal_accepted: 'proposal',
        proposal_to_approve: 'proposal',
        ...days,
      },
      values: { owner: 'option', from: 'day_from', to: 'day_to' },
      groupBys: ['stage', 'owner', 'source', 'month'],
      sorts: ['number', 'created', 'stageChanged', 'expectedFee', 'expectedOrders', 'closeDate'],
      sums: ['expectedFee', 'expectedOrders'],
      defaultFilters: [],
    },
    companies: {
      filters: {
        ...statusFilterOn('source', DEAL_LIST_SOURCES),
        with_merchant: 'merchant',
        no_merchant: 'merchant',
        with_open_deals: 'deals',
        no_open_deals: 'deals',
        mine: 'owner',
        unassigned: 'owner',
      },
      values: { owner: 'option' },
      groupBys: ['owner', 'source', 'city', 'category'],
      sorts: ['name', 'created', 'openDeals', 'wonDeals'],
      sums: ['openDeals', 'wonDeals', 'contacts'],
      defaultFilters: [],
    },
    proposals: {
      filters: {
        ...statusFilters(PROPOSAL_LIST_STATUSES),
        to_approve: 'approval',
        discount_over_limit: 'approval',
        confirmed: 'confirmed',
        this_month: 'date',
        last_month: 'date',
      },
      values: { owner: 'option' },
      groupBys: ['status', 'owner', 'month'],
      sorts: ['number', 'created', 'discount'],
      sums: [],
      defaultFilters: [],
    },
  },
  hr: {
    employees: {
      filters: {
        ...statusFilterOn('flag', EMPLOYEE_LIST_FLAGS),
        current: 'status',
        active: 'status',
        on_leave: 'status',
        suspended: 'status',
        employee: 'employment',
        outsourced: 'employment',
        monthly_salary: 'pay',
        per_delivery: 'pay',
      },
      values: { department: 'option', position: 'option', grade: 'option', store: 'option' },
      groupBys: ['department', 'store', 'position', 'employment', 'status', 'manager'],
      sorts: ['name', 'code', 'hired', 'documents', 'department', 'store'],
      sums: [],
      defaultFilters: [],
    },
    leave: {
      filters: {
        pending: 'status',
        ...statusFilters(LEAVE_LIST_STATUSES),
        waiting_for_me: 'mine',
        today: 'date',
        this_month: 'date',
        last_month: 'date',
        upcoming: 'date',
      },
      values: {
        type: 'option',
        store: 'option',
        department: 'option',
        from: 'day_from',
        to: 'day_to',
      },
      groupBys: ['status', 'type', 'employee', 'store', 'department', 'month'],
      sorts: ['number', 'from', 'days', 'created'],
      sums: ['days'],
      defaultFilters: ['pending'],
    },
    violations: {
      filters: {
        open: 'status',
        ...statusFilters(VIOLATION_LIST_STATUSES),
        ...statusFilterOn('penalty', VIOLATION_LIST_PENALTIES),
        for_supplier: 'supplier',
        employee: 'employment',
        outsourced: 'employment',
        ...days,
      },
      values: { type: 'option', store: 'option', from: 'day_from', to: 'day_to' },
      groupBys: ['status', 'type', 'employee', 'store', 'penalty', 'month'],
      sorts: ['number', 'occurred', 'amount'],
      sums: ['amount'],
      defaultFilters: [],
    },
    suggestions: {
      filters: {
        ...statusFilters(SUGGESTION_LIST_STATUSES),
        late: 'kind',
        absent: 'kind',
        ...days,
      },
      values: { store: 'option' },
      groupBys: ['kind', 'store', 'day', 'employee'],
      sorts: ['day', 'lateMinutes'],
      sums: [],
      defaultFilters: ['open'],
    },
  },
  accounting: {
    // Basata cash deposits (owner, 2026-11-11): waiting for review first, then by number.
    basata_deposits: {
      filters: {
        pending: 'status',
        approved: 'status',
        rejected: 'status',
        not_settled: 'settled',
        settled: 'settled',
        late: 'timing',
        ...days,
      },
      values: { store: 'option', rider: 'option', from: 'day_from', to: 'day_to' },
      groupBys: ['status', 'store', 'rider', 'day', 'settlement'],
      sorts: ['number', 'deposited', 'created', 'amount'],
      sums: ['amount'],
      defaultFilters: ['pending'],
    },
  },
} as const satisfies Partial<Record<AccessApp, Record<string, ListMeta>>>;

export type AppListApp = keyof typeof APP_LISTS;
export type AppListRef = {
  [A in AppListApp]: { app: A; id: keyof (typeof APP_LISTS)[A] & string };
}[AppListApp];

/** The list's meta, or null when the app has no such list. */
export function appListMeta(app: string, id: string): ListMeta | null {
  const lists = (APP_LISTS as Record<string, Record<string, ListMeta>>)[app];
  return lists && Object.hasOwn(lists, id) ? lists[id]! : null;
}

/** Lists of named people: they also need the customer data switch. */
export const APP_LISTS_WITH_CUSTOMER_DATA: readonly string[] = ['customers/customers'];
export function appListNeedsCustomerData(app: string, id: string) {
  return APP_LISTS_WITH_CUSTOMER_DATA.includes(`${app}/${id}`);
}

/** Every app list as app and id. */
export function appListRefs(): { app: AppListApp; id: string }[] {
  return (Object.keys(APP_LISTS) as AppListApp[]).flatMap((app) =>
    Object.keys(APP_LISTS[app]).map((id) => ({ app, id })),
  );
}

/** The keys parseListState accepts for an app list. */
export function appListKnown(app: string, id: string) {
  const meta = appListMeta(app, id);
  return meta ? listKnownOf(meta) : {};
}

/** Cancel several orders with one reason (the list's note), each under the usual rules. */
export const bulkCancelOrdersSchema = bulkIdsSchema.extend({
  note: z.string().trim().min(2).max(300),
});

// ─── UX phase C step 4: bulk actions of Sales and HR ───

/** Give several deals to one sales person, or back to the queue ("none"). */
export const bulkAssignDealsSchema = bulkIdsSchema.extend({
  ownerId: z.string().min(1).max(40),
});
/** Move several deals to one open stage (won and lost are decided one by one or as lost). */
export const bulkStageDealsSchema = bulkIdsSchema.extend({
  stage: z.enum(['new', 'contacted', 'meeting', 'proposal', 'negotiation']),
});
/** Mark several deals lost: the reason "other" with the note the list asks for. */
export const bulkLostDealsSchema = bulkIdsSchema.extend({
  note: z.string().trim().min(2).max(300),
});
/** Refuse several leave requests with one reason. */
export const bulkRejectLeaveSchema = bulkIdsSchema.extend({
  note: z.string().trim().min(2).max(300),
});
