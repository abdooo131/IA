import type { Prisma } from '@prisma/client';
import {
  addDays,
  cairoDay,
  cairoDayStart,
  comparisonRange,
  type CompareMode,
  debitNormal,
  type DrillLine,
  type DrillReport,
  type DrillReportResult,
  type DrillSection,
  entryNumber,
  type GroupValue,
  isCalendarDay,
  LEDGER_LINE_FILTERS,
  LEDGER_LINE_GROUPS,
  LEDGER_LINE_SORTS,
  LEDGER_LINE_SUMS,
  type LedgerLinesQuery,
  type ListDef,
  type ListQuery,
  type ListResult,
  parseListState,
  runList,
} from '@shiplynow/shared';
import type { Db } from '../client';
import { DomainError } from '../domain-error';
import {
  balanceSheet,
  isWallet,
  type LineTags,
  ownerNames,
  profitAndLoss,
  trialBalance,
} from './books';
import { KIND_FAMILIES, type ListScope } from './lists';

// Reports you can click into (Accounting UX phase B). The drill down reports are the same
// functions as the plain reports (profitAndLoss, balanceSheet, trialBalance), run once for the
// period and once for the comparison, with every line keyed by its account. Clicking a line
// opens its ledger lines (ledgerLinesList) whose totals are the report line exactly.

const MONEY_GROUPS = [1100, 1200, 1300];
/** The drill down loads every line of the slice (not only the newest 5000), so totals agree. */
const DRILL_MAX_LINES = 100_000;

const start = (day: string) => cairoDayStart(day);
const end = (day: string) => cairoDayStart(addDays(day, 1));

function checkRange(from: string, to: string) {
  if (!isCalendarDay(from) || !isCalendarDay(to)) throw new DomainError('invalid_date', 400);
  if (to < from) throw new DomainError('invalid_range', 400);
  if (end(to).getTime() - start(from).getTime() > 400 * 86_400_000)
    throw new DomainError('range_too_long', 400);
}

interface SectionLine {
  id?: string;
  code: string;
  nameEn: string;
  nameAr: string;
  amountPiastres: number;
  groupCode?: number;
  wallets?: number;
  debitPiastres?: number;
  creditPiastres?: number;
}

/** Keys a report line so the period and its comparison line up. */
const keyOf = (l: SectionLine) => (l.wallets !== undefined ? `group:${l.code}` : `id:${l.id}`);

function mergeSection(
  key: string,
  current: SectionLine[],
  previous: SectionLine[] | null,
  total: number,
  compareTotal: number | null,
): DrillSection {
  const byKey = new Map<string, DrillLine>();
  const toLine = (l: SectionLine): DrillLine => ({
    accountId: l.wallets !== undefined ? null : (l.id ?? null),
    walletGroup: l.wallets !== undefined ? Number(l.code) : null,
    wallets: l.wallets ?? null,
    code: l.code,
    nameEn: l.nameEn,
    nameAr: l.nameAr,
    amountPiastres: 0,
    ...(l.debitPiastres !== undefined ? { debitPiastres: 0, creditPiastres: 0 } : {}),
    compareAmountPiastres: previous ? 0 : null,
  });
  for (const l of current) {
    const line = toLine(l);
    line.amountPiastres = l.amountPiastres;
    if (l.debitPiastres !== undefined) {
      line.debitPiastres = l.debitPiastres;
      line.creditPiastres = l.creditPiastres;
    }
    byKey.set(keyOf(l), line);
  }
  for (const l of previous ?? []) {
    const k = keyOf(l);
    const line = byKey.get(k) ?? toLine(l);
    line.compareAmountPiastres = l.amountPiastres;
    if (l.wallets !== undefined && line.wallets !== null)
      line.wallets = Math.max(line.wallets, l.wallets);
    byKey.set(k, line);
  }
  const lines = [...byKey.values()]
    .filter((l) => l.amountPiastres !== 0 || (l.compareAmountPiastres ?? 0) !== 0 || l.wallets)
    .sort((a, b) => a.code.localeCompare(b.code));
  return { key, lines, totalPiastres: total, compareTotalPiastres: compareTotal };
}

export interface DrillInput {
  from: string;
  to: string;
  compare?: CompareMode;
  storeId?: string;
  merchantId?: string;
}

/**
 * A drill down report: profit and loss, balance sheet (as of `to`) or trial balance, grouped
 * by category with subtotals, filtered by store and merchant tags when asked, and with the
 * comparison period's figures beside each line.
 */
export async function drillReport(
  db: Db,
  report: DrillReport,
  input: DrillInput,
): Promise<DrillReportResult> {
  checkRange(input.from, input.to);
  const mode = input.compare ?? 'none';
  const other = comparisonRange({ from: input.from, to: input.to }, mode);
  const tags: LineTags = { darkStoreId: input.storeId, merchantId: input.merchantId };
  const base = {
    report,
    from: input.from,
    to: input.to,
    compare: other ? { mode, ...other } : null,
    filters: { store: input.storeId ?? null, merchant: input.merchantId ?? null },
  };

  if (report === 'profit_and_loss') {
    const [cur, prev] = await Promise.all([
      profitAndLoss(db, start(input.from), end(input.to), tags),
      other ? profitAndLoss(db, start(other.from), end(other.to), tags) : null,
    ]);
    return {
      ...base,
      sections: [
        mergeSection(
          'income',
          cur.income,
          prev?.income ?? null,
          cur.totalIncomePiastres,
          prev?.totalIncomePiastres ?? null,
        ),
        mergeSection(
          'expenses',
          cur.expenses,
          prev?.expenses ?? null,
          cur.totalExpensesPiastres,
          prev?.totalExpensesPiastres ?? null,
        ),
      ],
      result: {
        key: 'profit',
        amountPiastres: cur.profitPiastres,
        compareAmountPiastres: prev?.profitPiastres ?? null,
      },
    };
  }

  if (report === 'balance_sheet') {
    const [cur, prev] = await Promise.all([
      balanceSheet(db, input.to, tags),
      other ? balanceSheet(db, other.to, tags) : null,
    ]);
    const earnings = (s: typeof cur): SectionLine => ({
      code: '',
      nameEn: '',
      nameAr: '',
      amountPiastres: s.earningsPiastres,
    });
    const equity = mergeSection(
      'equity',
      cur.equity,
      prev?.equity ?? null,
      cur.totalEquityPiastres,
      prev?.totalEquityPiastres ?? null,
    );
    // The profit not yet closed into equity is its own line, drilled into income and costs.
    equity.lines.push({
      accountId: null,
      walletGroup: null,
      wallets: null,
      code: 'earnings',
      nameEn: '',
      nameAr: '',
      amountPiastres: earnings(cur).amountPiastres,
      compareAmountPiastres: prev ? earnings(prev).amountPiastres : null,
    });
    const gap = (s: typeof cur) =>
      s.totalAssetsPiastres - s.totalLiabilitiesPiastres - s.totalEquityPiastres;
    return {
      ...base,
      sections: [
        mergeSection(
          'assets',
          cur.assets,
          prev?.assets ?? null,
          cur.totalAssetsPiastres,
          prev?.totalAssetsPiastres ?? null,
        ),
        mergeSection(
          'liabilities',
          cur.liabilities,
          prev?.liabilities ?? null,
          cur.totalLiabilitiesPiastres,
          prev?.totalLiabilitiesPiastres ?? null,
        ),
        equity,
      ],
      result: {
        key: 'difference',
        amountPiastres: gap(cur),
        compareAmountPiastres: prev ? gap(prev) : null,
      },
    };
  }

  const [cur, prev] = await Promise.all([
    trialBalance(db, start(input.from), end(input.to), tags),
    other ? trialBalance(db, start(other.from), end(other.to), tags) : null,
  ]);
  const categories = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
  const lines = (rows: typeof cur.rows, category: string): SectionLine[] =>
    rows
      .filter((r) => r.category === category)
      .map((r) => ({
        id: r.id,
        code: r.code,
        nameEn: r.nameEn,
        nameAr: r.nameAr,
        amountPiastres: r.balancePiastres,
        debitPiastres: r.debitPiastres,
        creditPiastres: r.creditPiastres,
      }));
  const sum = (rows: SectionLine[]) => rows.reduce((s, r) => s + r.amountPiastres, 0);
  return {
    ...base,
    sections: categories.map((c) => {
      const a = lines(cur.rows, c);
      const b = prev ? lines(prev.rows, c) : null;
      return mergeSection(c, a, b, sum(a), b ? sum(b) : null);
    }),
    result: {
      key: 'difference',
      amountPiastres: cur.totalDebitPiastres - cur.totalCreditPiastres,
      compareAmountPiastres: prev ? prev.totalDebitPiastres - prev.totalCreditPiastres : null,
    },
    totals: { debitPiastres: cur.totalDebitPiastres, creditPiastres: cur.totalCreditPiastres },
  };
}

// ─── the ledger lines behind a report line ────────────────────────────────────

export interface LedgerLineRow {
  id: string;
  entryId: string;
  number: string;
  day: string;
  at: string;
  kind: string;
  memo: string | null;
  accountId: string;
  account: string;
  storeId: string | null;
  store: string | null;
  merchantId: string | null;
  merchant: string | null;
  riderId: string | null;
  rider: string | null;
  orderNumber: string | null;
  debit: number;
  credit: number;
  /** debit − credit */
  net: number;
}

/** The where clause of a drill down: an account, a wallet group or a report's slice. */
async function linesWhere(
  db: Db,
  q: LedgerLinesQuery & { report?: DrillReport },
  scope: ListScope,
): Promise<{ where: Prisma.LedgerLineWhereInput; naturalDebit: boolean | null }> {
  const where: Prisma.LedgerLineWhereInput = {};
  const and: Prisma.LedgerLineWhereInput[] = [];
  let naturalDebit: boolean | null = null;
  if (q.account) {
    const account = await db.ledgerAccount.findUnique({ where: { id: q.account } });
    if (!account) throw new DomainError('account_not_found', 404);
    where.accountId = account.id;
    naturalDebit = debitNormal(account.category);
  } else if (q.group) {
    // A group of wallets shown as one balance sheet line (store cash boxes stand alone).
    const accounts = await db.ledgerAccount.findMany({ where: { groupCode: q.group } });
    const wallets = accounts.filter((a) => isWallet(a) && a.darkStoreId == null);
    if (wallets.length === 0) throw new DomainError('account_not_found', 404);
    where.accountId = { in: wallets.map((a) => a.id) };
    naturalDebit = debitNormal(wallets[0]!.category);
  } else if (q.set === 'income_costs') {
    where.account = { category: { in: ['revenue', 'expense'] } };
  } else if (q.set === 'money') {
    where.account = { groupCode: { in: MONEY_GROUPS } };
    naturalDebit = true;
  } else throw new DomainError('account_required', 400);
  if (q.from || q.to) {
    if (q.from && !isCalendarDay(q.from)) throw new DomainError('invalid_date', 400);
    if (q.to && !isCalendarDay(q.to)) throw new DomainError('invalid_date', 400);
    where.occurredAt = {
      ...(q.from ? { gte: start(q.from) } : {}),
      ...(q.to ? { lt: end(q.to) } : {}),
    };
  }
  // Profit and loss (and profit per store) leave the year end entry out, as the reports do.
  if (q.report === 'profit_and_loss' || q.set === 'income_costs')
    and.push({ entry: { kind: { not: 'year_close' } } });
  if (q.kind) and.push({ entry: { kind: q.kind } });
  if (q.store) where.darkStoreId = q.store === 'none' ? null : q.store;
  if (q.merchant) where.merchantId = q.merchant === 'none' ? null : q.merchant;
  if (q.rider) where.riderId = q.rider === 'none' ? null : q.rider;
  // People limited to some stores see only those stores' lines.
  if (scope.storeIds) and.push({ darkStoreId: { in: scope.storeIds } });
  if (scope.merchantIds) and.push({ merchantId: { in: scope.merchantIds } });
  if (and.length) where.AND = and;
  return { where, naturalDebit };
}

async function loadLedgerLines(db: Db, where: Prisma.LedgerLineWhereInput) {
  const [rows, name, stores, merchants, riders] = await Promise.all([
    db.ledgerLine.findMany({
      where,
      select: {
        id: true,
        entryId: true,
        amountPiastres: true,
        occurredAt: true,
        accountId: true,
        darkStoreId: true,
        merchantId: true,
        riderId: true,
        account: true,
        entry: {
          select: { number: true, kind: true, memo: true, order: { select: { number: true } } },
        },
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: DRILL_MAX_LINES,
    }),
    ownerNames(db),
    db.darkStore.findMany({ select: { id: true, code: true } }),
    db.merchant.findMany({ select: { id: true, name: true } }),
    db.rider.findMany({ select: { id: true, badgeCode: true, user: { select: { name: true } } } }),
  ]);
  const storeName = new Map(stores.map((s) => [s.id, s.code]));
  const merchantName = new Map(merchants.map((m) => [m.id, m.name]));
  const riderName = new Map(riders.map((r) => [r.id, `${r.user.name} (${r.badgeCode})`]));
  return rows.map(
    (l): LedgerLineRow => ({
      id: l.id,
      entryId: l.entryId,
      number: entryNumber(l.entry.number),
      day: cairoDay(l.occurredAt),
      at: l.occurredAt.toISOString(),
      kind: l.entry.kind,
      memo: l.entry.memo,
      accountId: l.accountId,
      account: `${l.account.code} ${name(l.account).nameEn}`,
      storeId: l.darkStoreId,
      store: l.darkStoreId ? (storeName.get(l.darkStoreId) ?? l.darkStoreId) : null,
      merchantId: l.merchantId,
      merchant: l.merchantId ? (merchantName.get(l.merchantId) ?? l.merchantId) : null,
      riderId: l.riderId,
      rider: l.riderId ? (riderName.get(l.riderId) ?? l.riderId) : null,
      orderNumber: l.entry.order?.number ?? null,
      debit: l.amountPiastres > 0 ? l.amountPiastres : 0,
      credit: l.amountPiastres < 0 ? 0 - l.amountPiastres : 0,
      net: l.amountPiastres,
    }),
  );
}

const named = (key: string | null, label: string | null): GroupValue => ({
  key: key ?? '-',
  label: label ?? '-',
});
const family = (name: string) => ({
  group: 'kind',
  test: (r: LedgerLineRow) => (KIND_FAMILIES[name] ?? []).includes(r.kind),
});

export const LEDGER_LINES_DEF: ListDef<LedgerLineRow> = {
  id: 'ledger_lines',
  filters: {
    debit: { group: 'side', test: (r) => r.debit > 0 },
    credit: { group: 'side', test: (r) => r.credit > 0 },
    deliveries: family('deliveries'),
    cash: family('cash'),
    payouts: family('payouts'),
    bills: family('bills'),
    manual: family('manual'),
    with_order: { group: 'source', test: (r) => r.orderNumber !== null },
    no_store: { group: 'tag', test: (r) => r.storeId === null },
  },
  groupBys: {
    month: (r) => named(r.day.slice(0, 7), r.day.slice(0, 7)),
    day: (r) => named(r.day, r.day),
    store: (r) => named(r.storeId, r.store),
    merchant: (r) => named(r.merchantId, r.merchant),
    rider: (r) => named(r.riderId, r.rider),
    kind: (r) => named(r.kind, r.kind),
    account: (r) => named(r.accountId, r.account),
  },
  search: (r) => [r.number, r.memo, r.orderNumber, r.kind, r.account, r.store, r.merchant, r.rider],
  sorts: { day: (r) => r.at, number: (r) => r.number, amount: (r) => Math.abs(r.net) },
  defaultSort: { key: 'day', desc: true },
  sums: LEDGER_LINE_SUMS,
};

/** For tests: the shared keys and the definition agree. */
export function ledgerLinesGaps(): string[] {
  const gaps: string[] = [];
  for (const [f, g] of Object.entries(LEDGER_LINE_FILTERS))
    if (LEDGER_LINES_DEF.filters[f]?.group !== g) gaps.push(`filter.${f}`);
  for (const g of LEDGER_LINE_GROUPS) if (!LEDGER_LINES_DEF.groupBys[g]) gaps.push(`group.${g}`);
  for (const s of LEDGER_LINE_SORTS) if (!LEDGER_LINES_DEF.sorts[s]) gaps.push(`sort.${s}`);
  return gaps;
}

/**
 * The ledger lines behind a report line, as a list view: filters (side, kind family, with an
 * order, no store), grouping by month, store, merchant, rider, kind or account, and totals of
 * debit, credit and net over every line that passes. `total` is the report's figure for the
 * slice (the natural balance: debit − credit for assets and costs, the other way round else).
 */
export async function ledgerLinesList(
  db: Db,
  q: LedgerLinesQuery & { report?: DrillReport },
  query: ListQuery,
  scope: ListScope,
  now: Date = new Date(),
): Promise<
  ListResult<LedgerLineRow> & { meta: { naturalDebit: boolean | null; truncated: boolean } }
> {
  const { where, naturalDebit } = await linesWhere(db, q, scope);
  const rows = await loadLedgerLines(db, where);
  const state = parseListState(query, {
    filters: Object.keys(LEDGER_LINE_FILTERS),
    groupBys: LEDGER_LINE_GROUPS,
    sorts: LEDGER_LINE_SORTS,
  });
  const result = runList(
    rows,
    LEDGER_LINES_DEF,
    state,
    { today: cairoDay(now), userId: scope.userId },
    { open: query.open ? query.open.split('\n') : undefined, all: query.all === '1' },
  );
  return { ...result, meta: { naturalDebit, truncated: rows.length >= DRILL_MAX_LINES } };
}
