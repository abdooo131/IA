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
