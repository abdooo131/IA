import 'server-only';
import { canDo, FINANCE_LISTS, type FinanceListId, type ListMeta } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { BulkAction, ListColumn, ListData, ListViewConfig } from '@/lib/list-view';

// The Accounting lists as list views: their columns, filters, groupings and bulk actions,
// with every label in the reader's language. The filter and grouping keys come from
// FINANCE_LISTS (packages/shared), the same keys the API implements.

type Col = Omit<ListColumn, 'label'> & { label?: string };

const COLUMNS: Record<FinanceListId, Col[]> = {
  payouts: [
    { key: 'number', kind: 'ltr', sort: 'number', primary: true },
    { key: 'merchant', kind: 'text', sort: 'merchant' },
    { key: 'createdDay', kind: 'date', sort: 'created' },
    { key: 'cutoffDay', kind: 'date', sort: 'cutoff', optional: true },
    { key: 'createdBy', kind: 'text', optional: true },
    { key: 'paidBy', kind: 'text', optional: true },
    { key: 'reference', kind: 'ltr', optional: true },
    { key: 'needsApproval', kind: 'bool' },
    { key: 'status', kind: 'status' },
    { key: 'amount', kind: 'money', sort: 'amount' },
  ],
  bills: [
    { key: 'number', kind: 'ltr', sort: 'number', primary: true },
    { key: 'supplier', kind: 'text', sort: 'supplier' },
    { key: 'reference', kind: 'ltr', optional: true },
    { key: 'billDay', kind: 'date', sort: 'bill_day' },
    { key: 'dueDay', kind: 'date', sort: 'due_day' },
    { key: 'store', kind: 'ltr', optional: true },
    { key: 'account', kind: 'text', optional: true },
    { key: 'status', kind: 'status' },
    { key: 'total', kind: 'money', sort: 'total' },
    { key: 'vat', kind: 'money', optional: true },
    { key: 'paid', kind: 'money', optional: true },
    { key: 'left', kind: 'money', sort: 'left' },
  ],
  journal: [
    { key: 'number', kind: 'ltr', sort: 'number', primary: true },
    { key: 'day', kind: 'date', sort: 'day' },
    { key: 'kind', kind: 'text' },
    { key: 'memo', kind: 'text' },
    { key: 'orderNumber', kind: 'ltr', optional: true },
    { key: 'accounts', kind: 'ltr', optional: true },
    { key: 'createdBy', kind: 'text', optional: true },
    { key: 'receipts', kind: 'number', optional: true },
    { key: 'amount', kind: 'money', sort: 'amount' },
  ],
  cheques: [
    { key: 'number', kind: 'ltr', sort: 'number', primary: true },
    { key: 'direction', kind: 'text' },
    { key: 'party', kind: 'text', sort: 'party' },
    { key: 'chequeNumber', kind: 'ltr' },
    { key: 'bank', kind: 'text', optional: true },
    { key: 'dueDay', kind: 'date', sort: 'due_day' },
    { key: 'status', kind: 'status' },
    { key: 'amount', kind: 'money', sort: 'amount' },
  ],
  rider_withdrawals: [
    { key: 'number', kind: 'ltr', sort: 'number', primary: true },
    { key: 'rider', kind: 'text', sort: 'rider' },
    { key: 'badge', kind: 'ltr', optional: true },
    { key: 'store', kind: 'ltr' },
    { key: 'method', kind: 'text' },
    { key: 'createdAt', kind: 'datetime', sort: 'created' },
    { key: 'status', kind: 'status' },
    { key: 'deduction', kind: 'money', optional: true },
    { key: 'amount', kind: 'money', sort: 'amount' },
  ],
  approvals: [
    { key: 'kind', kind: 'text', sort: 'kind', primary: true },
    { key: 'reference', kind: 'text' },
    { key: 'requestedBy', kind: 'text' },
    { key: 'createdAt', kind: 'datetime', sort: 'created' },
    { key: 'decidedBy', kind: 'text', optional: true },
    { key: 'entryNumber', kind: 'ltr', optional: true },
    { key: 'receipts', kind: 'number', optional: true },
    { key: 'status', kind: 'status' },
    { key: 'amount', kind: 'money', sort: 'amount' },
  ],
  petty_cash: [
    { key: 'number', kind: 'ltr', sort: 'number', primary: true },
    { key: 'store', kind: 'ltr' },
    { key: 'category', kind: 'text' },
    { key: 'note', kind: 'text' },
    { key: 'createdBy', kind: 'text', optional: true },
    { key: 'createdAt', kind: 'datetime', sort: 'created' },
    { key: 'status', kind: 'status' },
    { key: 'amount', kind: 'money', sort: 'amount' },
  ],
  expense_claims: [
    { key: 'number', kind: 'ltr', sort: 'number', primary: true },
    { key: 'person', kind: 'text', sort: 'person' },
    { key: 'store', kind: 'ltr' },
    { key: 'category', kind: 'text' },
    { key: 'note', kind: 'text', optional: true },
    { key: 'paidOn', kind: 'date', sort: 'paid_on' },
    { key: 'createdAt', kind: 'datetime', sort: 'created', optional: true },
    { key: 'approvedBy', kind: 'text', optional: true },
    { key: 'paidBy', kind: 'text', optional: true },
    { key: 'status', kind: 'status' },
    { key: 'vat', kind: 'money' },
    { key: 'amount', kind: 'money', sort: 'amount' },
  ],
  invoices: [
    { key: 'number', kind: 'ltr', sort: 'number', primary: true },
    { key: 'type', kind: 'text' },
    { key: 'merchant', kind: 'text', sort: 'merchant' },
    { key: 'period', kind: 'ltr' },
    { key: 'issuedDay', kind: 'date', sort: 'issued' },
    { key: 'eta', kind: 'status' },
    { key: 'net', kind: 'money', optional: true },
    { key: 'vat', kind: 'money' },
    { key: 'total', kind: 'money', sort: 'total' },
  ],
};

const HREFS: Partial<Record<FinanceListId, string>> = {
  payouts: '/finance/payouts/{id}',
  bills: '/finance/bills/{id}',
  journal: '/finance/journal/{id}',
  cheques: '/finance/cheques/{id}',
  rider_withdrawals: '/finance/rider-withdrawals/{id}',
  approvals: '/finance/approvals/{id}',
  petty_cash: '/finance/petty-cash/{id}',
  invoices: '/finance/invoices/{id}',
  expense_claims: '/finance/expense-claims/{id}',
};

/** The list view of one Accounting list, labelled in the reader's language. */
export async function financeListConfig(id: FinanceListId): Promise<ListViewConfig> {
  const [t, tf, tw, tr, tc, tp, ti, tm, profile] = await Promise.all([
    getTranslations('lists'),
    getTranslations('finance'),
    getTranslations('workflow'),
    getTranslations('riderPay'),
    getTranslations('finance.cheques'),
    getTranslations('cashControl.petty'),
    getTranslations('finance.invoices'),
    getTranslations('myPay'),
    getMyProfile(),
  ]);
  const meta: ListMeta = FINANCE_LISTS[id];
  const label = (k: string) =>
    t.has(`${id}.columns.${k}`) ? t(`${id}.columns.${k}`) : t(`columns.${k}`);
  const states = (keys: readonly string[], ns?: (k: string) => string | null) =>
    Object.fromEntries(
      keys.map((k) => [k, ns?.(k) ?? (tw.has(`states.${k}`) ? tw(`states.${k}`) : k)]),
    );
  const has = (fn: { has: (k: string) => boolean }, k: string) => fn.has(k);

  const valueLabels: Record<string, Record<string, string>> = {};
  switch (id) {
    case 'payouts':
      valueLabels.status = states(['draft', 'paid', 'cancelled']);
      break;
    case 'bills':
      valueLabels.status = states(['open', 'paid', 'cancelled']);
      break;
    case 'journal': {
      const kinds = Object.keys(tf.raw('kinds') as Record<string, string>);
      valueLabels.kind = Object.fromEntries(kinds.map((k) => [k, tf(`kinds.${k}`)]));
      break;
    }
    case 'cheques':
      valueLabels.status = states(
        ['awaiting_approval', 'received', 'issued', 'deposited', 'cleared', 'bounced', 'cancelled'],
        (k) => (has(tc, `statuses.${k}`) ? tc(`statuses.${k}`) : null),
      );
      valueLabels.direction = {
        received: tc('directions.received'),
        issued: tc('directions.issued'),
      };
      break;
    case 'rider_withdrawals':
      valueLabels.status = states(
        ['requested', 'approved', 'paid', 'rejected', 'cancelled'],
        (k) => (has(tr, `statuses.${k}`) ? tr(`statuses.${k}`) : null),
      );
      valueLabels.method = Object.fromEntries(
        ['store_cash', 'instapay', 'mobile_wallet', 'bank'].map((k) => [k, tr(`methods.${k}`)]),
      );
      break;
    case 'approvals': {
      const kinds = Object.keys(tf.raw('approvals.kinds') as Record<string, string>);
      valueLabels.kind = Object.fromEntries(kinds.map((k) => [k, tf(`approvals.kinds.${k}`)]));
      valueLabels.status = states(['pending', 'approved', 'rejected', 'cancelled'], (k) =>
        tf(`approvals.statuses.${k}`),
      );
      break;
    }
    case 'petty_cash':
      valueLabels.status = states(['posted', 'pending', 'rejected', 'cancelled', 'reversed'], (k) =>
        tp(`statuses.${k}`),
      );
      break;
    case 'expense_claims':
      valueLabels.status = states(
        ['pending_manager', 'pending_accounting', 'paid', 'rejected', 'cancelled'],
        (k) => (has(tm, `statuses.${k}`) ? tm(`statuses.${k}`) : null),
      );
      break;
    case 'invoices':
      valueLabels.type = {
        invoice: ti('taxInvoice'),
        credit_note: ti('creditNote'),
        debit_note: ti('debitNote'),
      };
      valueLabels.eta = states(['not_sent', 'signed', 'submitted', 'valid', 'invalid', 'rejected']);
      break;
  }

  const bulk: BulkAction[] = [];
  if (id === 'approvals' && canDo(profile, 'accounting', 'manage'))
    bulk.push(
      {
        key: 'approve',
        label: t('bulk.approve'),
        endpoint: '/finance/requests/bulk-decide',
        body: { approve: true },
        note: 'optional',
      },
      {
        key: 'reject',
        label: t('bulk.reject'),
        endpoint: '/finance/requests/bulk-decide',
        body: { approve: false },
        note: 'required',
        tone: 'danger',
      },
    );
  if (id === 'payouts' && canDo(profile, 'accounting', 'manage'))
    bulk.push({
      key: 'approve',
      label: t('bulk.approvePayouts'),
      endpoint: '/finance/payouts/bulk-approve',
    });

  // Expense claims: approve the manager step for the people the reader manages (each claim is
  // checked on its own; others answer not_your_team).
  if (id === 'expense_claims')
    bulk.push({
      key: 'approve',
      label: t('bulk.approveClaims'),
      endpoint: '/finance/expense-claims/bulk-approve',
    });

  return {
    listId: `finance_${id}`,
    endpoint: `/finance/lists/${id}`,
    columns: COLUMNS[id].map((c) => ({ ...c, label: c.label ?? label(c.key) })),
    filters: Object.entries(meta.filters).map(([key, group]) => ({
      key,
      group,
      label: t.has(`${id}.filters.${key}`) ? t(`${id}.filters.${key}`) : t(`filters.${key}`),
    })),
    groupBys: meta.groupBys.map((key) => ({
      key,
      label: t.has(`${id}.groups.${key}`) ? t(`${id}.groups.${key}`) : t(`groups.${key}`),
    })),
    valueLabels,
    rowHref: HREFS[id],
    bulkActions: bulk.length ? bulk : undefined,
    defaultFilters: [...meta.defaultFilters],
    exportName: t(`${id}.exportName`),
  };
}

/** The rows of a list for the address the page was opened with. */
export function financeListData(
  id: FinanceListId,
  searchParams: Record<string, string | string[] | undefined>,
) {
  const query = new URLSearchParams();
  for (const k of ['q', 'f', 'g', 'sort', 'desc', 'page', 'size']) {
    const v = searchParams[k];
    const value = Array.isArray(v) ? v[0] : v;
    if (value !== undefined) query.set(k, value);
  }
  return apiGet<ListData>(`/finance/lists/${id}?${query}`);
}
