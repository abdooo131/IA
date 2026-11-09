// The Accounting lists converted to list views (Accounting UX phase A). Each list names its
// predefined filters (key → the group they OR within), its groupings, its sortable columns,
// its summed money columns and the filters it opens with. The API's list definitions
// (packages/db/src/finance/lists.ts) implement exactly these keys and the web builds its
// Filters and Group by menus from them, so both sides always agree.

import type { ListMeta } from './list-view';

const dateFilters = { this_month: 'date', last_month: 'date', last_7_days: 'date' } as const;

export const FINANCE_LISTS = {
  payouts: {
    filters: {
      draft: 'status',
      paid: 'status',
      cancelled: 'status',
      needs_approval: 'approval',
      for_me_to_approve: 'approval',
      ...dateFilters,
      mine: 'who',
    },
    groupBys: ['merchant', 'status', 'month', 'created_by'],
    sorts: ['number', 'merchant', 'created', 'cutoff', 'amount'],
    sums: ['amount'],
    defaultFilters: [],
  },
  bills: {
    filters: {
      open: 'status',
      paid: 'status',
      cancelled: 'status',
      overdue: 'due',
      due_7_days: 'due',
      ...dateFilters,
    },
    groupBys: ['supplier', 'status', 'store', 'account', 'month'],
    sorts: ['number', 'supplier', 'bill_day', 'due_day', 'total', 'left'],
    sums: ['total', 'vat', 'paid', 'left'],
    defaultFilters: ['open'],
  },
  journal: {
    filters: {
      today: 'date',
      ...dateFilters,
      deliveries: 'kind',
      cash: 'kind',
      payouts: 'kind',
      bills: 'kind',
      manual: 'kind',
      with_order: 'source',
      without_receipt: 'receipt',
    },
    groupBys: ['kind', 'day', 'month', 'created_by'],
    sorts: ['number', 'day', 'amount'],
    sums: ['amount'],
    defaultFilters: ['last_7_days'],
  },
  cheques: {
    filters: {
      received: 'direction',
      issued: 'direction',
      awaiting_approval: 'status',
      open: 'status',
      cleared: 'status',
      bounced_or_cancelled: 'status',
      overdue: 'due',
      due_7_days: 'due',
    },
    groupBys: ['direction', 'status', 'party', 'bank', 'month'],
    sorts: ['number', 'party', 'due_day', 'amount'],
    sums: ['amount'],
    defaultFilters: [],
  },
  rider_withdrawals: {
    filters: {
      requested: 'status',
      approved: 'status',
      paid: 'status',
      rejected_or_cancelled: 'status',
      ...dateFilters,
    },
    groupBys: ['store', 'rider', 'status', 'method', 'month'],
    sorts: ['number', 'rider', 'created', 'amount'],
    sums: ['amount', 'deduction'],
    defaultFilters: ['requested', 'approved'],
  },
  approvals: {
    filters: {
      pending: 'status',
      approved: 'status',
      rejected: 'status',
      cancelled: 'status',
      waiting_for_me: 'who',
      asked_by_me: 'who',
      money_in: 'direction',
      money_out: 'direction',
      ...dateFilters,
    },
    groupBys: ['kind', 'status', 'requested_by', 'month'],
    sorts: ['created', 'amount', 'kind'],
    sums: ['amount'],
    defaultFilters: ['pending'],
  },
  petty_cash: {
    filters: {
      posted: 'status',
      pending: 'status',
      rejected: 'status',
      reversed: 'status',
      ...dateFilters,
    },
    groupBys: ['store', 'category', 'status', 'created_by', 'month'],
    sorts: ['number', 'created', 'amount'],
    sums: ['amount'],
    defaultFilters: [],
  },
  invoices: {
    filters: {
      invoice: 'type',
      credit_note: 'type',
      not_sent: 'eta',
      sent: 'eta',
      accepted: 'eta',
      needs_fix: 'eta',
      ...dateFilters,
    },
    groupBys: ['merchant', 'type', 'period', 'eta'],
    sorts: ['number', 'merchant', 'issued', 'total'],
    sums: ['net', 'vat', 'total'],
    defaultFilters: [],
  },
} as const satisfies Record<string, ListMeta>;

export type FinanceListId = keyof typeof FINANCE_LISTS;
export const FINANCE_LIST_IDS = Object.keys(FINANCE_LISTS) as FinanceListId[];

/** The keys parseListState accepts for one list. */
export function listKnown(id: FinanceListId) {
  const meta: ListMeta = FINANCE_LISTS[id];
  return {
    filters: Object.keys(meta.filters),
    groupBys: meta.groupBys,
    sorts: meta.sorts,
  };
}

/** Months as YYYY-MM from a Cairo day, and the month before. */
export function monthOfDay(day: string) {
  return day.slice(0, 7);
}
export function previousMonth(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}
