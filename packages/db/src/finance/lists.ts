import {
  cairoDay,
  chequeLabel,
  entryNumber,
  FINANCE_LISTS,
  type FinanceListId,
  type GroupValue,
  LIST_MAX_ROWS,
  type ListCtx,
  type ListDef,
  type ListQuery,
  type ListResult,
  monthOfDay,
  payoutNumber,
  pettyCashLabel,
  previousMonth,
  addDays,
  withdrawalNumber,
  billNumber,
  expenseClaimNumber,
} from '@shiplynow/shared';
import type { Db } from '../client';
import { listGaps, type ListScope, queryList, type RegisteredList } from '../list-query';
import { getSetting } from '../settings';
import { invoiceLabel } from './invoices';
import { pettyStatusOf } from './cash-control';

// The Accounting list views (docs/ARCHITECTURE.md "List views and document pages"). Each list
// loads its most recent rows (LIST_MAX_ROWS) inside the person's scope, flattened to plain
// values, and runList applies the list state from the address: search, the predefined
// filters of FINANCE_LISTS, grouping with subtotals, totals, sorting and paging.

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const dbDay = (d: Date) => d.toISOString().slice(0, 10);
const storeIn = (scope: ListScope) => (scope.storeIds ? { in: scope.storeIds } : undefined);
const merchantIn = (scope: ListScope) =>
  scope.merchantIds ? { in: scope.merchantIds } : undefined;

/** The shared date filters on a Cairo day field. */
function dateFilters<R>(dayOf: (r: R) => string | null) {
  return {
    this_month: {
      group: 'date',
      test: (r: R, ctx: ListCtx) => monthOfDay(dayOf(r) ?? '') === monthOfDay(ctx.today),
    },
    last_month: {
      group: 'date',
      test: (r: R, ctx: ListCtx) =>
        monthOfDay(dayOf(r) ?? '') === previousMonth(monthOfDay(ctx.today)),
    },
    last_7_days: {
      group: 'date',
      test: (r: R, ctx: ListCtx) => (dayOf(r) ?? '') >= addDays(ctx.today, -6),
    },
  };
}
const monthGroup = (value: string | null): GroupValue => ({
  key: value ? value.slice(0, 7) : '-',
  label: value ? value.slice(0, 7) : '-',
});
const named = (key: string | null, label: string | null): GroupValue => ({
  key: key ?? '-',
  label: label ?? '-',
});

// ─── payouts ────────────────────────────────────────────────────────────────────

export interface PayoutListRow {
  id: string;
  number: string;
  merchantId: string;
  merchant: string;
  status: string;
  cutoffDay: string;
  createdDay: string;
  createdAt: string;
  paidAt: string | null;
  amount: number;
  reference: string | null;
  createdById: string;
  createdBy: string;
  paidBy: string | null;
  approvedBy: string | null;
  needsApproval: boolean;
}

async function loadPayouts(db: Db, scope: ListScope): Promise<PayoutListRow[]> {
  const [rows, limit] = await Promise.all([
    db.payout.findMany({
      where: { merchantId: merchantIn(scope) },
      include: {
        merchant: { select: { name: true } },
        createdBy: { select: { name: true } },
        paidBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: LIST_MAX_ROWS,
    }),
    getSetting(db, 'finance.approval_threshold_piastres'),
  ]);
  return rows.map((p) => ({
    id: p.id,
    number: payoutNumber(p.number),
    merchantId: p.merchantId,
    merchant: p.merchant.name,
    // A draft a second person approved shows as Approved (the stored status stays draft).
    status: p.status === 'draft' && p.approvedById ? 'approved' : p.status,
    cutoffDay: cairoDay(new Date(p.cutoffAt.getTime() - 1)),
    createdDay: cairoDay(p.createdAt),
    createdAt: p.createdAt.toISOString(),
    paidAt: iso(p.paidAt),
    amount: p.amountPiastres,
    reference: p.reference,
    createdById: p.createdById,
    createdBy: p.createdBy.name,
    paidBy: p.paidBy?.name ?? null,
    approvedBy: p.approvedBy?.name ?? null,
    needsApproval:
      p.status === 'draft' && limit > 0 && p.amountPiastres >= limit && !p.approvedById,
  }));
}

const payouts: ListDef<PayoutListRow> = {
  id: 'payouts',
  filters: {
    // Not paid yet: drafts, approved or not.
    draft: { group: 'status', test: (r) => r.status === 'draft' || r.status === 'approved' },
    paid: { group: 'status', test: (r) => r.status === 'paid' },
    cancelled: { group: 'status', test: (r) => r.status === 'cancelled' },
    needs_approval: { group: 'approval', test: (r) => r.needsApproval },
    for_me_to_approve: {
      group: 'approval',
      test: (r, ctx) => r.needsApproval && r.createdById !== ctx.userId,
    },
    ...dateFilters<PayoutListRow>((r) => r.createdDay),
    mine: { group: 'who', test: (r, ctx) => r.createdById === ctx.userId },
  },
  groupBys: {
    merchant: (r) => named(r.merchantId, r.merchant),
    status: (r) => named(r.status, r.status),
    month: (r) => monthGroup(r.createdDay),
    created_by: (r) => named(r.createdById, r.createdBy),
  },
  search: (r) => [r.number, r.merchant, r.reference, r.createdBy],
  sorts: {
    number: (r) => r.number,
    merchant: (r) => r.merchant,
    created: (r) => r.createdAt,
    cutoff: (r) => r.cutoffDay,
    amount: (r) => r.amount,
  },
  defaultSort: { key: 'created', desc: true },
  sums: FINANCE_LISTS.payouts.sums,
};

// ─── bills ──────────────────────────────────────────────────────────────────────

export interface BillListRow {
  id: string;
  number: string;
  supplierId: string;
  supplier: string;
  reference: string;
  billDay: string;
  dueDay: string;
  storeId: string | null;
  store: string | null;
  account: string;
  status: string;
  overdue: boolean;
  currency: string;
  net: number;
  vat: number;
  total: number;
  paid: number;
  left: number;
  memo: string | null;
}

async function loadBills(db: Db, scope: ListScope): Promise<BillListRow[]> {
  const rows = await db.bill.findMany({
    where: scope.storeIds ? { OR: [{ darkStoreId: null }, { darkStoreId: storeIn(scope) }] } : {},
    include: {
      supplier: { select: { name: true } },
      expenseAccount: { select: { code: true, nameEn: true } },
      darkStore: { select: { code: true } },
    },
    orderBy: { number: 'desc' },
    take: LIST_MAX_ROWS,
  });
  const today = cairoDay(new Date());
  return rows.map((b) => {
    const due = dbDay(b.dueDate);
    return {
      id: b.id,
      number: billNumber(b.number),
      supplierId: b.supplierId,
      supplier: b.supplier.name,
      reference: b.reference,
      billDay: dbDay(b.billDate),
      dueDay: due,
      storeId: b.darkStoreId,
      store: b.darkStore?.code ?? null,
      account: `${b.expenseAccount.code} ${b.expenseAccount.nameEn}`,
      status: b.status,
      overdue: b.status === 'open' && due < today,
      currency: b.currency,
      net: b.netPiastres,
      vat: b.vatPiastres,
      total: b.totalPiastres,
      paid: b.paidPiastres,
      left: b.status === 'open' ? b.totalPiastres - b.paidPiastres : 0,
      memo: b.memo,
    };
  });
}

const bills: ListDef<BillListRow> = {
  id: 'bills',
  filters: {
    open: { group: 'status', test: (r) => r.status === 'open' },
    paid: { group: 'status', test: (r) => r.status === 'paid' },
    cancelled: { group: 'status', test: (r) => r.status === 'cancelled' },
    overdue: { group: 'due', test: (r, ctx) => r.status === 'open' && r.dueDay < ctx.today },
    due_7_days: {
      group: 'due',
      test: (r, ctx) => r.status === 'open' && r.dueDay <= addDays(ctx.today, 7),
    },
    ...dateFilters<BillListRow>((r) => r.billDay),
  },
  groupBys: {
    supplier: (r) => named(r.supplierId, r.supplier),
    status: (r) => named(r.status, r.status),
    store: (r) => named(r.storeId, r.store),
    account: (r) => named(r.account, r.account),
    month: (r) => monthGroup(r.billDay),
  },
  search: (r) => [r.number, r.supplier, r.reference, r.memo, r.account, r.store],
  sorts: {
    number: (r) => r.number,
    supplier: (r) => r.supplier,
    bill_day: (r) => r.billDay,
    due_day: (r) => r.dueDay,
    total: (r) => r.total,
    left: (r) => r.left,
  },
  defaultSort: { key: 'number', desc: true },
  sums: FINANCE_LISTS.bills.sums,
};

// ─── suppliers ──────────────────────────────────────────────────────────────────

export interface SupplierListRow {
  id: string;
  name: string;
  /** supplier, rider_office or staffing_company (people hired through it) */
  kind: string;
  status: 'active' | 'inactive';
  taxId: string | null;
  phone: string | null;
  email: string | null;
  whtPercent: number;
  accountCode: string | null;
  openBills: number;
  people: number;
  /** What we owe them; below zero they owe us */
  balance: number;
}

async function loadSuppliers(db: Db): Promise<SupplierListRow[]> {
  const rows = await db.supplier.findMany({
    include: {
      accounts: { select: { id: true, code: true } },
      _count: {
        select: {
          bills: { where: { status: 'open' } },
          staff: { where: { status: { not: 'left' } } },
        },
      },
    },
    orderBy: { name: 'asc' },
    take: LIST_MAX_ROWS,
  });
  const sums = await db.ledgerLine.groupBy({
    by: ['accountId'],
    where: { accountId: { in: rows.flatMap((s) => s.accounts.map((a) => a.id)) } },
    _sum: { amountPiastres: true },
  });
  const sumOf = new Map(sums.map((x) => [x.accountId, x._sum.amountPiastres ?? 0]));
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.isRiderOffice ? 'rider_office' : s._count.staff > 0 ? 'staffing_company' : 'supplier',
    status: s.isActive ? 'active' : 'inactive',
    taxId: s.taxId,
    phone: s.phone,
    email: s.email,
    whtPercent: s.whtBp / 100,
    accountCode: s.accounts[0]?.code ?? null,
    openBills: s._count.bills,
    people: s._count.staff,
    // Their wallet holds a credit balance when we owe them: shown positive.
    balance: -s.accounts.reduce((t, a) => t + (sumOf.get(a.id) ?? 0), 0),
  }));
}

const suppliers: ListDef<SupplierListRow> = {
  id: 'suppliers',
  filters: {
    active: { group: 'status', test: (r) => r.status === 'active' },
    inactive: { group: 'status', test: (r) => r.status === 'inactive' },
    rider_office: { group: 'kind', test: (r) => r.kind === 'rider_office' },
    staffing_company: { group: 'kind', test: (r) => r.kind === 'staffing_company' },
    has_tax_number: { group: 'tax', test: (r) => !!r.taxId },
    no_tax_number: { group: 'tax', test: (r) => !r.taxId },
    owes_us: { group: 'balance', test: (r) => r.balance < 0 },
    we_owe_them: { group: 'balance', test: (r) => r.balance > 0 },
  },
  groupBys: {
    kind: (r) => named(r.kind, r.kind),
    status: (r) => named(r.status, r.status),
  },
  search: (r) => [r.name, r.taxId, r.phone, r.email, r.accountCode],
  sorts: {
    name: (r) => r.name.toLowerCase(),
    balance: (r) => r.balance,
    open_bills: (r) => r.openBills,
  },
  defaultSort: { key: 'name', desc: false },
  sums: FINANCE_LISTS.suppliers.sums,
};

// ─── journal ────────────────────────────────────────────────────────────────────

export const KIND_FAMILIES: Record<string, readonly string[]> = {
  deliveries: [
    'cod_collected',
    'order_fee',
    'cod_fee',
    'failed_fee',
    'receiving_fee',
    'storage_fee',
    'rider_bonus',
    'return_fee',
    'minimum_fee',
    'postal_fee',
  ],
  cash: [
    'cash_handover',
    'cash_difference',
    'bank_deposit',
    'money_transfer',
    'petty_cash',
    'petty_cash_reversal',
    'basata_deposit',
    'basata_deadline_charge',
    'basata_settlement',
  ],
  payouts: ['merchant_payout', 'rider_bonus_payout', 'rider_withdrawal'],
  bills: [
    'supplier_bill',
    'supplier_bill_cancel',
    'bill_payment',
    'expense',
    'expense_claim',
    'tax_payment',
    'po_receipt',
    'packaging_purchase',
  ],
  manual: ['journal', 'adjustment'],
};

export interface JournalListRow {
  id: string;
  number: string;
  day: string;
  at: string;
  kind: string;
  memo: string | null;
  orderNumber: string | null;
  createdById: string | null;
  createdBy: string | null;
  accounts: string;
  amount: number;
  lines: number;
  receipts: number;
}

async function loadJournal(db: Db, scope: ListScope): Promise<JournalListRow[]> {
  const rows = await db.ledgerEntry.findMany({
    where: scope.storeIds
      ? { lines: { some: { darkStoreId: { in: scope.storeIds } } } }
      : undefined,
    select: {
      id: true,
      number: true,
      kind: true,
      memo: true,
      occurredAt: true,
      createdById: true,
      createdBy: { select: { name: true } },
      order: { select: { number: true } },
      lines: { select: { amountPiastres: true, account: { select: { code: true } } } },
      _count: { select: { receipts: true } },
    },
    orderBy: [{ occurredAt: 'desc' }, { number: 'desc' }],
    take: LIST_MAX_ROWS,
  });
  return rows.map((e) => ({
    id: e.id,
    number: entryNumber(e.number),
    day: cairoDay(e.occurredAt),
    at: e.occurredAt.toISOString(),
    kind: e.kind,
    memo: e.memo,
    orderNumber: e.order?.number ?? null,
    createdById: e.createdById,
    createdBy: e.createdBy?.name ?? null,
    accounts: [...new Set(e.lines.map((l) => l.account.code))].join(' '),
    amount: e.lines.reduce((s, l) => s + Math.max(l.amountPiastres, 0), 0),
    lines: e.lines.length,
    receipts: e._count.receipts,
  }));
}

const family = (name: string) => ({
  group: 'kind',
  test: (r: JournalListRow) => (KIND_FAMILIES[name] ?? []).includes(r.kind),
});

const journal: ListDef<JournalListRow> = {
  id: 'journal',
  filters: {
    today: { group: 'date', test: (r, ctx) => r.day === ctx.today },
    ...dateFilters<JournalListRow>((r) => r.day),
    deliveries: family('deliveries'),
    cash: family('cash'),
    payouts: family('payouts'),
    bills: family('bills'),
    manual: family('manual'),
    with_order: { group: 'source', test: (r) => r.orderNumber !== null },
    without_receipt: {
      group: 'receipt',
      test: (r) => r.receipts === 0 && r.createdById !== null && r.orderNumber === null,
    },
  },
  groupBys: {
    kind: (r) => named(r.kind, r.kind),
    day: (r) => named(r.day, r.day),
    month: (r) => monthGroup(r.day),
    created_by: (r) => named(r.createdById, r.createdBy),
  },
  search: (r) => [r.number, r.memo, r.orderNumber, r.kind, r.accounts, r.createdBy],
  sorts: { number: (r) => r.number, day: (r) => r.at, amount: (r) => r.amount },
  defaultSort: { key: 'day', desc: true },
  sums: FINANCE_LISTS.journal.sums,
};

// ─── cheques ────────────────────────────────────────────────────────────────────

export interface ChequeListRow {
  id: string;
  number: string;
  chequeNumber: string;
  direction: string;
  purpose: string;
  status: string;
  party: string;
  bank: string;
  issueDay: string;
  dueDay: string;
  amount: number;
}

const OPEN_CHEQUE = ['received', 'issued', 'deposited'];

async function loadCheques(db: Db, scope: ListScope): Promise<ChequeListRow[]> {
  const rows = await db.cheque.findMany({
    where: scope.merchantIds
      ? { OR: [{ merchantId: null }, { merchantId: { in: scope.merchantIds } }] }
      : undefined,
    orderBy: { number: 'desc' },
    take: LIST_MAX_ROWS,
  });
  return rows.map((c) => ({
    id: c.id,
    number: chequeLabel(c.number),
    chequeNumber: c.chequeNumber,
    direction: c.direction,
    purpose: c.purpose,
    status: c.status,
    party: c.partyName,
    bank: c.bankName,
    issueDay: dbDay(c.issueDate),
    dueDay: dbDay(c.dueDate),
    amount: c.amountPiastres,
  }));
}

const cheques: ListDef<ChequeListRow> = {
  id: 'cheques',
  filters: {
    received: { group: 'direction', test: (r) => r.direction === 'received' },
    issued: { group: 'direction', test: (r) => r.direction === 'issued' },
    awaiting_approval: { group: 'status', test: (r) => r.status === 'awaiting_approval' },
    open: { group: 'status', test: (r) => OPEN_CHEQUE.includes(r.status) },
    cleared: { group: 'status', test: (r) => r.status === 'cleared' },
    bounced_or_cancelled: {
      group: 'status',
      test: (r) => r.status === 'bounced' || r.status === 'cancelled',
    },
    overdue: {
      group: 'due',
      test: (r, ctx) => OPEN_CHEQUE.includes(r.status) && r.dueDay < ctx.today,
    },
    due_7_days: {
      group: 'due',
      test: (r, ctx) => OPEN_CHEQUE.includes(r.status) && r.dueDay <= addDays(ctx.today, 7),
    },
  },
  groupBys: {
    direction: (r) => named(r.direction, r.direction),
    status: (r) => named(r.status, r.status),
    party: (r) => named(r.party, r.party),
    bank: (r) => named(r.bank, r.bank),
    month: (r) => monthGroup(r.dueDay),
  },
  search: (r) => [r.number, r.chequeNumber, r.party, r.bank],
  sorts: {
    number: (r) => r.number,
    party: (r) => r.party,
    due_day: (r) => r.dueDay,
    amount: (r) => r.amount,
  },
  defaultSort: { key: 'number', desc: true },
  sums: FINANCE_LISTS.cheques.sums,
};

// ─── rider withdrawals ──────────────────────────────────────────────────────────

export interface WithdrawalListRow {
  id: string;
  number: string;
  riderId: string;
  rider: string;
  badge: string;
  storeId: string;
  store: string;
  status: string;
  method: string;
  createdDay: string;
  createdAt: string;
  amount: number;
  deduction: number;
}

async function loadWithdrawals(db: Db, scope: ListScope): Promise<WithdrawalListRow[]> {
  const rows = await db.riderWithdrawal.findMany({
    where: { darkStoreId: storeIn(scope) },
    include: {
      rider: { select: { badgeCode: true, user: { select: { name: true } } } },
      darkStore: { select: { code: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: LIST_MAX_ROWS,
  });
  return rows.map((w) => ({
    id: w.id,
    number: withdrawalNumber(w.number),
    riderId: w.riderId,
    rider: w.rider.user.name,
    badge: w.rider.badgeCode,
    storeId: w.darkStoreId,
    store: w.darkStore.code,
    status: w.status,
    method: w.method,
    createdDay: cairoDay(w.createdAt),
    createdAt: w.createdAt.toISOString(),
    amount: w.amountPiastres,
    deduction: w.deductionPiastres,
  }));
}

const riderWithdrawals: ListDef<WithdrawalListRow> = {
  id: 'rider_withdrawals',
  filters: {
    requested: { group: 'status', test: (r) => r.status === 'requested' },
    approved: { group: 'status', test: (r) => r.status === 'approved' },
    paid: { group: 'status', test: (r) => r.status === 'paid' },
    rejected_or_cancelled: {
      group: 'status',
      test: (r) => r.status === 'rejected' || r.status === 'cancelled',
    },
    ...dateFilters<WithdrawalListRow>((r) => r.createdDay),
  },
  groupBys: {
    store: (r) => named(r.storeId, r.store),
    rider: (r) => named(r.riderId, `${r.rider} (${r.badge})`),
    status: (r) => named(r.status, r.status),
    method: (r) => named(r.method, r.method),
    month: (r) => monthGroup(r.createdDay),
  },
  search: (r) => [r.number, r.rider, r.badge, r.store],
  sorts: {
    number: (r) => r.number,
    rider: (r) => r.rider,
    created: (r) => r.createdAt,
    amount: (r) => r.amount,
  },
  defaultSort: { key: 'created', desc: true },
  sums: FINANCE_LISTS.rider_withdrawals.sums,
};

// ─── expense claims ─────────────────────────────────────────────────────────────

export interface ExpenseClaimListRow {
  id: string;
  number: string;
  personId: string;
  person: string;
  userId: string;
  storeId: string | null;
  store: string | null;
  categoryId: string;
  category: string;
  status: string;
  paidOn: string;
  createdDay: string;
  createdAt: string;
  note: string;
  approvedBy: string | null;
  managerDecidedById: string | null;
  paidBy: string | null;
  amount: number;
  /** VAT on the receipt (a tax invoice), claimed back when paid; 0 when none */
  vat: number;
  /** Waiting for accounting and the reader may pay it (not their own, not the second person) */
  canPay: boolean;
}

async function loadClaims(db: Db, scope: ListScope): Promise<ExpenseClaimListRow[]> {
  const [rows, limit] = await Promise.all([
    db.expenseClaim.findMany({
      // People limited to some stores see their stores' claims and company wide ones.
      where: scope.storeIds
        ? { OR: [{ darkStoreId: { in: scope.storeIds } }, { darkStoreId: null }] }
        : {},
      include: {
        user: { select: { name: true } },
        darkStore: { select: { code: true } },
        expenseAccount: { select: { code: true, nameEn: true } },
        managerDecidedBy: { select: { name: true } },
        paidBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: LIST_MAX_ROWS,
    }),
    getSetting(db, 'finance.approval_threshold_piastres'),
  ]);
  return rows.map((c) => ({
    id: c.id,
    number: expenseClaimNumber(c.number),
    personId: c.employeeId,
    person: c.user.name,
    userId: c.userId,
    storeId: c.darkStoreId,
    store: c.darkStore?.code ?? null,
    categoryId: c.expenseAccountId,
    category: `${c.expenseAccount.code} ${c.expenseAccount.nameEn ?? ''}`.trim(),
    status: c.status,
    paidOn: dbDay(c.paidOn),
    createdDay: cairoDay(c.createdAt),
    createdAt: c.createdAt.toISOString(),
    note: c.note,
    approvedBy: c.managerDecidedBy?.name ?? null,
    managerDecidedById: c.managerDecidedById,
    paidBy: c.paidBy?.name ?? null,
    amount: c.amountPiastres,
    vat: c.vatPiastres ?? 0,
    canPay:
      c.status === 'pending_accounting' &&
      c.userId !== scope.userId &&
      !(c.managerDecidedById === scope.userId && limit > 0 && c.amountPiastres >= limit),
  }));
}

const expenseClaims: ListDef<ExpenseClaimListRow> = {
  id: 'expense_claims',
  filters: {
    pending_manager: { group: 'status', test: (r) => r.status === 'pending_manager' },
    pending_accounting: { group: 'status', test: (r) => r.status === 'pending_accounting' },
    paid: { group: 'status', test: (r) => r.status === 'paid' },
    rejected_or_cancelled: {
      group: 'status',
      test: (r) => r.status === 'rejected' || r.status === 'cancelled',
    },
    // Approved claims I may pay now (never my own, never the second person rule broken).
    waiting_for_me: {
      group: 'who',
      test: (r, ctx) => r.canPay && r.userId !== ctx.userId,
    },
    company_wide: { group: 'store', test: (r) => r.storeId === null },
    ...dateFilters<ExpenseClaimListRow>((r) => r.createdDay),
  },
  groupBys: {
    person: (r) => named(r.personId, r.person),
    store: (r) => named(r.storeId, r.store),
    category: (r) => named(r.categoryId, r.category),
    status: (r) => named(r.status, r.status),
    month: (r) => monthGroup(r.createdDay),
  },
  search: (r) => [r.number, r.person, r.store, r.category, r.note],
  sorts: {
    number: (r) => r.number,
    person: (r) => r.person,
    paid_on: (r) => r.paidOn,
    created: (r) => r.createdAt,
    amount: (r) => r.amount,
  },
  defaultSort: { key: 'created', desc: true },
  sums: FINANCE_LISTS.expense_claims.sums,
};

// ─── approvals (finance requests) ───────────────────────────────────────────────

/** Requests that claim money coming in or change what we owe a merchant. */
export const MONEY_IN_REQUESTS = [
  'capital_in',
  'other_income',
  'merchant_receipt',
  'merchant_adjustment',
  'cheque_in',
  'deposit_in',
];

export interface ApprovalListRow {
  id: string;
  kind: string;
  status: string;
  amount: number;
  reference: string | null;
  memo: string | null;
  requestedById: string;
  requestedBy: string;
  createdDay: string;
  createdAt: string;
  decidedBy: string | null;
  entryNumber: string | null;
  receipts: number;
  storeId: string | null;
}

async function loadApprovals(db: Db, scope: ListScope): Promise<ApprovalListRow[]> {
  const rows = await db.financeRequest.findMany({
    orderBy: { createdAt: 'desc' },
    take: LIST_MAX_ROWS,
    include: {
      requestedBy: { select: { name: true } },
      decidedBy: { select: { name: true } },
      entry: { select: { number: true } },
      _count: { select: { receipts: true } },
    },
  });
  const list = rows.map((r) => {
    const input = ((r.payload as { input?: Record<string, unknown> } | null)?.input ?? {}) as {
      reference?: string;
      reason?: string;
      memo?: string;
      month?: string;
      darkStoreId?: string;
    };
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      amount: r.amountPiastres,
      reference:
        input.reference ?? input.reason ?? (input.month ? `Salaries ${input.month}` : null),
      memo: input.memo ?? null,
      requestedById: r.requestedById,
      requestedBy: r.requestedBy.name,
      createdDay: cairoDay(r.createdAt),
      createdAt: r.createdAt.toISOString(),
      decidedBy: r.decidedBy?.name ?? null,
      entryNumber: r.entry ? entryNumber(r.entry.number) : null,
      receipts: r._count.receipts,
      storeId: input.darkStoreId ?? null,
    };
  });
  // People limited to some stores see their stores' requests and company wide ones.
  return scope.storeIds
    ? list.filter((r) => !r.storeId || scope.storeIds!.includes(r.storeId))
    : list;
}

const approvals: ListDef<ApprovalListRow> = {
  id: 'approvals',
  filters: {
    pending: { group: 'status', test: (r) => r.status === 'pending' },
    approved: { group: 'status', test: (r) => r.status === 'approved' },
    rejected: { group: 'status', test: (r) => r.status === 'rejected' },
    cancelled: { group: 'status', test: (r) => r.status === 'cancelled' },
    waiting_for_me: {
      group: 'who',
      test: (r, ctx) => r.status === 'pending' && r.requestedById !== ctx.userId,
    },
    asked_by_me: { group: 'who', test: (r, ctx) => r.requestedById === ctx.userId },
    money_in: { group: 'direction', test: (r) => MONEY_IN_REQUESTS.includes(r.kind) },
    money_out: { group: 'direction', test: (r) => !MONEY_IN_REQUESTS.includes(r.kind) },
    ...dateFilters<ApprovalListRow>((r) => r.createdDay),
  },
  groupBys: {
    kind: (r) => named(r.kind, r.kind),
    status: (r) => named(r.status, r.status),
    requested_by: (r) => named(r.requestedById, r.requestedBy),
    month: (r) => monthGroup(r.createdDay),
  },
  search: (r) => [r.kind, r.reference, r.memo, r.requestedBy, r.entryNumber],
  sorts: { created: (r) => r.createdAt, amount: (r) => r.amount, kind: (r) => r.kind },
  defaultSort: { key: 'created', desc: true },
  sums: FINANCE_LISTS.approvals.sums,
  defaultFilters: FINANCE_LISTS.approvals.defaultFilters,
};

// ─── petty cash ─────────────────────────────────────────────────────────────────

export interface PettyListRow {
  id: string;
  number: string;
  storeId: string;
  store: string;
  category: string;
  status: string;
  note: string;
  amount: number;
  createdById: string;
  createdBy: string;
  createdDay: string;
  createdAt: string;
}

async function loadPetty(db: Db, scope: ListScope): Promise<PettyListRow[]> {
  const rows = await db.pettyCashExpense.findMany({
    where: { darkStoreId: storeIn(scope) },
    include: {
      darkStore: { select: { code: true } },
      expenseAccount: { select: { code: true, nameEn: true } },
      createdBy: { select: { name: true } },
      request: { select: { status: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: LIST_MAX_ROWS,
  });
  return rows.map((r) => ({
    id: r.id,
    number: pettyCashLabel(r.number),
    storeId: r.darkStoreId,
    store: r.darkStore.code,
    category: `${r.expenseAccount.code} ${r.expenseAccount.nameEn}`,
    status: pettyStatusOf(r),
    note: r.note,
    amount: r.amountPiastres,
    createdById: r.createdById,
    createdBy: r.createdBy.name,
    createdDay: cairoDay(r.createdAt),
    createdAt: r.createdAt.toISOString(),
  }));
}

const pettyCash: ListDef<PettyListRow> = {
  id: 'petty_cash',
  filters: {
    posted: { group: 'status', test: (r) => r.status === 'posted' },
    pending: { group: 'status', test: (r) => r.status === 'pending' },
    rejected: {
      group: 'status',
      test: (r) => r.status === 'rejected' || r.status === 'cancelled',
    },
    reversed: { group: 'status', test: (r) => r.status === 'reversed' },
    ...dateFilters<PettyListRow>((r) => r.createdDay),
  },
  groupBys: {
    store: (r) => named(r.storeId, r.store),
    category: (r) => named(r.category, r.category),
    status: (r) => named(r.status, r.status),
    created_by: (r) => named(r.createdById, r.createdBy),
    month: (r) => monthGroup(r.createdDay),
  },
  search: (r) => [r.number, r.store, r.category, r.note, r.createdBy],
  sorts: { number: (r) => r.number, created: (r) => r.createdAt, amount: (r) => r.amount },
  defaultSort: { key: 'created', desc: true },
  sums: FINANCE_LISTS.petty_cash.sums,
};

// ─── tax invoices and credit notes ──────────────────────────────────────────────

export interface InvoiceListRow {
  id: string;
  number: string;
  type: string;
  merchantId: string;
  merchant: string;
  period: string | null;
  issuedDay: string;
  issuedAt: string;
  eta: string;
  net: number;
  vat: number;
  total: number;
}

const ETA_GROUP: Record<string, string> = {
  not_sent: 'not_sent',
  signed: 'sent',
  submitted: 'sent',
  valid: 'accepted',
  invalid: 'needs_fix',
  rejected: 'needs_fix',
};

async function loadInvoices(db: Db, scope: ListScope): Promise<InvoiceListRow[]> {
  const rows = await db.taxInvoice.findMany({
    where: { merchantId: merchantIn(scope) },
    include: { merchant: { select: { name: true } } },
    orderBy: [{ issuedAt: 'desc' }, { number: 'desc' }],
    take: LIST_MAX_ROWS,
  });
  return rows.map((r) => ({
    id: r.id,
    number: invoiceLabel(r.type, r.number),
    type: r.type,
    merchantId: r.merchantId,
    merchant: r.merchant.name,
    period: r.periodMonth,
    issuedDay: cairoDay(r.issuedAt),
    issuedAt: r.issuedAt.toISOString(),
    eta: r.etaStatus,
    // A credit note gives fees back: it counts against the invoices in totals.
    net: r.type === 'credit_note' ? -r.netPiastres : r.netPiastres,
    vat: r.type === 'credit_note' ? -r.vatPiastres : r.vatPiastres,
    total: r.type === 'credit_note' ? -r.totalPiastres : r.totalPiastres,
  }));
}

const eta = (name: string) => ({
  group: 'eta',
  test: (r: InvoiceListRow) => ETA_GROUP[r.eta] === name,
});

const invoices: ListDef<InvoiceListRow> = {
  id: 'invoices',
  filters: {
    invoice: { group: 'type', test: (r) => r.type === 'invoice' },
    credit_note: { group: 'type', test: (r) => r.type === 'credit_note' },
    debit_note: { group: 'type', test: (r) => r.type === 'debit_note' },
    not_sent: eta('not_sent'),
    sent: eta('sent'),
    accepted: eta('accepted'),
    needs_fix: eta('needs_fix'),
    ...dateFilters<InvoiceListRow>((r) => r.issuedDay),
  },
  groupBys: {
    merchant: (r) => named(r.merchantId, r.merchant),
    type: (r) => named(r.type, r.type),
    period: (r) => named(r.period, r.period),
    eta: (r) => named(r.eta, r.eta),
  },
  search: (r) => [r.number, r.merchant, r.period],
  sorts: {
    number: (r) => r.number,
    merchant: (r) => r.merchant,
    issued: (r) => r.issuedAt,
    total: (r) => r.total,
  },
  defaultSort: { key: 'issued', desc: true },
  sums: FINANCE_LISTS.invoices.sums,
};

// ─── the registry ───────────────────────────────────────────────────────────────

export const FINANCE_LIST_DEFS: Record<FinanceListId, RegisteredList> = {
  payouts: { def: payouts, load: loadPayouts },
  bills: { def: bills, load: loadBills },
  suppliers: { def: suppliers, load: loadSuppliers },
  journal: { def: journal, load: loadJournal },
  cheques: { def: cheques, load: loadCheques },
  rider_withdrawals: { def: riderWithdrawals, load: loadWithdrawals },
  approvals: { def: approvals, load: loadApprovals },
  petty_cash: { def: pettyCash, load: loadPetty },
  invoices: { def: invoices, load: loadInvoices },
  expense_claims: { def: expenseClaims, load: loadClaims },
};

/**
 * One Accounting list for the address: the list's own default filters when the address names
 * none, the rows in the person's scope, then search, filters, grouping, totals and paging.
 */
export function queryFinanceList(
  db: Db,
  id: FinanceListId,
  query: ListQuery,
  scope: ListScope,
  now: Date = new Date(),
): Promise<ListResult<Record<string, unknown>>> {
  return queryList(db, FINANCE_LIST_DEFS[id], FINANCE_LISTS[id], query, scope, now);
}

/** For tests: every filter and grouping the shared meta names exists in the definitions. */
export function financeListGaps(): string[] {
  return (Object.keys(FINANCE_LISTS) as FinanceListId[]).flatMap((id) =>
    listGaps(id, FINANCE_LISTS[id], FINANCE_LIST_DEFS[id]),
  );
}
