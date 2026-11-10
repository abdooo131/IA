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

const statusFilters = <S extends readonly string[]>(statuses: S) =>
  Object.fromEntries(statuses.map((s) => [s, 'status'])) as Record<S[number], 'status'>;

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
