import type { Prisma } from '@prisma/client';
import { addDays, cairoDay, cairoDayStart, isCalendarDay } from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { addMonths } from './assets';
import { post } from './ledger';

type Tx = Prisma.TransactionClient;

// Reports over a period and the year end: VAT per month, budget against actual, where cash
// came from and went (and the next four weeks), closing a year into retained earnings, and
// the journal in a form any accounting program imports.

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthStart = (month: string) => cairoDayStart(`${month}-01`);
const monthEndExclusive = (month: string) => monthStart(addMonths(month, 1));

// ─── VAT ───────────────────────────────────────────────────────────────────────

/**
 * VAT per month of a year: charged on our fees (output), claimed back on bills and
 * expenses (input), what is due for the month, and what was paid to the tax authority.
 */
export async function vatReport(db: Db, year: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100)
    throw new DomainError('invalid_year', 400);
  const rows = await db.$queryRaw<{ month: string; output: bigint; input: bigint; paid: bigint }[]>`
    SELECT to_char(l.occurred_at AT TIME ZONE 'Africa/Cairo', 'YYYY-MM') AS month,
      COALESCE(-SUM(l.amount_piastres) FILTER (WHERE e.kind <> 'tax_payment' AND l.amount_piastres < 0), 0) AS output,
      COALESCE(SUM(l.amount_piastres) FILTER (WHERE e.kind <> 'tax_payment' AND l.amount_piastres > 0), 0) AS input,
      COALESCE(SUM(l.amount_piastres) FILTER (WHERE e.kind = 'tax_payment'), 0) AS paid
    FROM ledger_lines l
      JOIN ledger_accounts a ON a.id = l.account_id
      JOIN ledger_entries e ON e.id = l.entry_id
    WHERE a.key = 'vat_payable'
      AND l.occurred_at >= ${cairoDayStart(`${year}-01-01`)}
      AND l.occurred_at < ${cairoDayStart(`${year + 1}-01-01`)}
    GROUP BY 1`;
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const list = months.map((m) => {
    const r = rows.find((x) => x.month === m);
    const output = Number(r?.output ?? 0);
    const input = Number(r?.input ?? 0);
    return {
      month: m,
      outputPiastres: output,
      inputPiastres: input,
      duePiastres: output - input,
      paidPiastres: Number(r?.paid ?? 0),
    };
  });
  const sum = (k: 'outputPiastres' | 'inputPiastres' | 'duePiastres' | 'paidPiastres') =>
    list.reduce((s, r) => s + r[k], 0);
  return {
    year,
    months: list,
    total: {
      outputPiastres: sum('outputPiastres'),
      inputPiastres: sum('inputPiastres'),
      duePiastres: sum('duePiastres'),
      paidPiastres: sum('paidPiastres'),
    },
  };
}

// ─── budgets ───────────────────────────────────────────────────────────────────

/** Sets (or clears with 0) the budget of an income or expense account for a month. */
export async function setBudget(
  db: Db,
  input: {
    month: string;
    accountId: string;
    darkStoreId?: string | null;
    amountPiastres: number;
    actorUserId: string;
  },
) {
  if (!MONTH.test(input.month)) throw new DomainError('invalid_month', 400);
  if (!Number.isSafeInteger(input.amountPiastres) || input.amountPiastres < 0)
    throw new DomainError('invalid_amount', 400);
  return inTransaction(db, async (tx) => {
    const account = await tx.ledgerAccount.findUnique({ where: { id: input.accountId } });
    if (!account || !['revenue', 'expense'].includes(account.category))
      throw new DomainError('account_not_found', 404);
    const storeId = input.darkStoreId || null;
    if (storeId && !(await tx.darkStore.findUnique({ where: { id: storeId } })))
      throw new DomainError('store_not_found', 404);
    const before = await tx.budget.findFirst({
      where: { month: input.month, accountId: account.id, darkStoreId: storeId },
    });
    const row = before
      ? await tx.budget.update({
          where: { id: before.id },
          data: {
            amountPiastres: input.amountPiastres,
            updatedById: input.actorUserId,
            updatedAt: new Date(),
          },
        })
      : await tx.budget.create({
          data: {
            month: input.month,
            accountId: account.id,
            darkStoreId: storeId,
            amountPiastres: input.amountPiastres,
            updatedById: input.actorUserId,
          },
        });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.budget_set',
      entityType: 'budget',
      entityId: row.id,
      before: { amount: before?.amountPiastres ?? null },
      after: {
        month: input.month,
        account: account.code,
        store: storeId,
        amount: row.amountPiastres,
      },
    });
    return row;
  });
}

/**
 * Budget against actual for a month, per income and expense account. With a store, only
 * that store's budgets and lines; without one, the whole company (every store and the
 * company wide part together).
 */
export async function budgetVsActual(db: Db, input: { month: string; darkStoreId?: string }) {
  if (!MONTH.test(input.month)) throw new DomainError('invalid_month', 400);
  const storeId = input.darkStoreId || null;
  const [accounts, budgets, actual] = await Promise.all([
    db.ledgerAccount.findMany({
      where: { category: { in: ['revenue', 'expense'] }, isActive: true },
      orderBy: { code: 'asc' },
    }),
    db.budget.findMany({
      where: { month: input.month, ...(storeId ? { darkStoreId: storeId } : {}) },
    }),
    db.$queryRaw<{ account_id: string; amount: bigint }[]>`
      SELECT l.account_id, SUM(l.amount_piastres) AS amount
      FROM ledger_lines l JOIN ledger_entries e ON e.id = l.entry_id
      WHERE l.occurred_at >= ${monthStart(input.month)}
        AND l.occurred_at < ${monthEndExclusive(input.month)}
        AND e.kind <> 'year_close'
        AND (${storeId}::text IS NULL OR l.dark_store_id = ${storeId})
      GROUP BY l.account_id`,
  ]);
  const rows = accounts.map((a) => {
    const raw = Number(actual.find((x) => x.account_id === a.id)?.amount ?? 0);
    const actualPiastres = a.category === 'revenue' ? -raw : raw;
    const budgetPiastres = budgets
      .filter((b) => b.accountId === a.id)
      .reduce((s, b) => s + b.amountPiastres, 0);
    // Better than plan is positive: more income, or less cost.
    const variance =
      a.category === 'revenue' ? actualPiastres - budgetPiastres : budgetPiastres - actualPiastres;
    return {
      accountId: a.id,
      code: a.code,
      category: a.category,
      nameEn: a.nameEn ?? '',
      nameAr: a.nameAr ?? a.nameEn ?? '',
      budgetPiastres,
      actualPiastres,
      variancePiastres: variance,
    };
  });
  const sum = (category: string, k: 'budgetPiastres' | 'actualPiastres') =>
    rows.filter((r) => r.category === category).reduce((s, r) => s + r[k], 0);
  return {
    month: input.month,
    darkStoreId: storeId,
    rows,
    income: {
      budgetPiastres: sum('revenue', 'budgetPiastres'),
      actualPiastres: sum('revenue', 'actualPiastres'),
    },
    costs: {
      budgetPiastres: sum('expense', 'budgetPiastres'),
      actualPiastres: sum('expense', 'actualPiastres'),
    },
  };
}

// ─── cash flow ─────────────────────────────────────────────────────────────────

/** Banks, cash boxes and cash riders carry: everything that is money. */
const MONEY_GROUPS = [1100, 1200, 1300];

const SECTION: Record<string, 'investing' | 'financing'> = {
  asset_purchase: 'investing',
  capital_in: 'financing',
  capital_out: 'financing',
};

async function moneyAt(db: Db, at: Date) {
  const [row] = await db.$queryRaw<{ total: bigint | null }[]>`
    SELECT SUM(l.amount_piastres) AS total
    FROM ledger_lines l JOIN ledger_accounts a ON a.id = l.account_id
    WHERE a.group_code = ANY(${MONEY_GROUPS}) AND l.occurred_at < ${at}`;
  return Number(row?.total ?? 0);
}

/** How money changed per kind of entry between two moments; moves between our own accounts cancel out. */
async function moneyByKind(db: Db, from: Date, to: Date) {
  const rows = await db.$queryRaw<{ kind: string; money_in: bigint; money_out: bigint }[]>`
    WITH per_entry AS (
      SELECT e.kind, SUM(l.amount_piastres) AS net
      FROM ledger_lines l
        JOIN ledger_accounts a ON a.id = l.account_id
        JOIN ledger_entries e ON e.id = l.entry_id
      WHERE a.group_code = ANY(${MONEY_GROUPS})
        AND l.occurred_at >= ${from} AND l.occurred_at < ${to}
      GROUP BY e.id, e.kind
    )
    SELECT kind,
      COALESCE(SUM(net) FILTER (WHERE net > 0), 0) AS money_in,
      COALESCE(-SUM(net) FILTER (WHERE net < 0), 0) AS money_out
    FROM per_entry GROUP BY kind`;
  return rows
    .map((r) => ({
      kind: r.kind,
      section: SECTION[r.kind] ?? ('operating' as const),
      inPiastres: Number(r.money_in),
      outPiastres: Number(r.money_out),
    }))
    .filter((r) => r.inPiastres !== 0 || r.outPiastres !== 0);
}

/** Where money came from and went in a period (direct method), by section and entry kind. */
export async function cashFlow(db: Db, input: { from: Date; to: Date }) {
  const [opening, closing, kinds] = await Promise.all([
    moneyAt(db, input.from),
    moneyAt(db, input.to),
    moneyByKind(db, input.from, input.to),
  ]);
  const sections = (['operating', 'investing', 'financing'] as const).map((section) => {
    const rows = kinds
      .filter((k) => k.section === section)
      .sort((a, b) => b.inPiastres - b.outPiastres - (a.inPiastres - a.outPiastres));
    return {
      section,
      rows,
      netPiastres: rows.reduce((s, r) => s + r.inPiastres - r.outPiastres, 0),
    };
  });
  return {
    from: input.from,
    to: input.to,
    openingPiastres: opening,
    closingPiastres: closing,
    sections,
  };
}

/** Kinds forecast from what is already known (bills, salaries, taxes...), not from the past. */
const PLANNED_KINDS = [
  'expense',
  'bill_payment',
  'payroll',
  'tax_payment',
  'staff_advance',
  'prepayment',
  'asset_purchase',
  'capital_in',
  'capital_out',
  'other_income',
];

/**
 * The next four weeks of money: today's money, the usual weekly result of trading (fees,
 * COD in and payouts out, averaged over the last eight weeks), then what is already known
 * to go out: supplier bills by due date (late ones in week one), recurring expenses on
 * their day, the salary run at the end of the month, and the taxes owed now (week one).
 */
export async function cashForecast(db: Db, now: Date = new Date()) {
  const today = cairoDay(now);
  const start = cairoDayStart(today);
  const past = await moneyByKind(db, cairoDayStart(addDays(today, -56)), start);
  const trading = past
    .filter((k) => !PLANNED_KINDS.includes(k.kind))
    .reduce((s, k) => s + k.inPiastres - k.outPiastres, 0);
  const weeklyTrading = Math.round(trading / 8);
  const [money, bills, recurring, salaries, taxes] = await Promise.all([
    moneyAt(db, now),
    db.bill.findMany({ where: { status: 'open' } }),
    db.recurringEntry.findMany({ where: { isActive: true } }),
    db.staffSalary.aggregate({
      where: { user: { isActive: true } },
      _sum: { monthlyPiastres: true },
    }),
    db.$queryRaw<{ owed: bigint | null }[]>`
      SELECT -SUM(l.amount_piastres) AS owed FROM ledger_lines l
      JOIN ledger_accounts a ON a.id = l.account_id
      WHERE a.key IN ('vat_payable', 'wht_payable')`,
  ]);
  const salaryTotal = salaries._sum.monthlyPiastres ?? 0;
  const taxesOwed = Math.max(0, Number(taxes[0]?.owed ?? 0));
  let balance = money;
  const weeks = [];
  for (let w = 0; w < 4; w++) {
    const first = addDays(today, w * 7);
    const last = addDays(first, 6);
    const inWeek = (day: string) => day >= first && day <= last;
    const billsDue = bills
      .filter((b) => {
        const due = b.dueDate.toISOString().slice(0, 10);
        return w === 0 ? due <= last : inWeek(due);
      })
      .reduce((s, b) => s + b.totalPiastres - b.paidPiastres, 0);
    let recurringDue = 0;
    for (let d = 0; d < 7; d++) {
      const day = addDays(first, d);
      const month = day.slice(0, 7);
      for (const r of recurring)
        if (
          Number(day.slice(8, 10)) === r.dayOfMonth &&
          r.startMonth <= month &&
          (!r.endMonth || r.endMonth >= month)
        )
          recurringDue += r.amountPiastres;
    }
    // Salaries are paid on the month's last day when it falls in this week.
    const monthEnds = Array.from({ length: 7 }, (_, d) => addDays(first, d)).filter(
      (day) => addDays(day, 1).slice(8, 10) === '01',
    ).length;
    const salaryDue = monthEnds * salaryTotal;
    const taxDue = w === 0 ? taxesOwed : 0;
    const out = billsDue + recurringDue + salaryDue + taxDue;
    const opening = balance;
    balance = opening + weeklyTrading - out;
    weeks.push({
      from: first,
      to: last,
      openingPiastres: opening,
      tradingPiastres: weeklyTrading,
      billsPiastres: billsDue,
      recurringPiastres: recurringDue,
      salariesPiastres: salaryDue,
      taxesPiastres: taxDue,
      closingPiastres: balance,
    });
  }
  return { today, moneyPiastres: money, weeklyTradingPiastres: weeklyTrading, weeks };
}

// ─── year end ──────────────────────────────────────────────────────────────────

const yearEnd = (year: number) => cairoDayStart(`${year + 1}-01-01`);

async function profitBalances(tx: Tx | Db, before: Date) {
  return tx.$queryRaw<{ account_id: string; balance: bigint }[]>`
    SELECT l.account_id, SUM(l.amount_piastres) AS balance
    FROM ledger_lines l JOIN ledger_accounts a ON a.id = l.account_id
    WHERE a.category IN ('revenue', 'expense') AND l.occurred_at < ${before}
    GROUP BY l.account_id HAVING SUM(l.amount_piastres) <> 0`;
}

/** Which years have activity and which are closed into retained earnings. */
export async function yearCloseStatus(db: Db, now: Date = new Date()) {
  const [years, closed] = await Promise.all([
    db.$queryRaw<{ year: number }[]>`
      SELECT DISTINCT EXTRACT(YEAR FROM occurred_at AT TIME ZONE 'Africa/Cairo')::int AS year
      FROM ledger_lines ORDER BY 1`,
    db.ledgerEntry.findMany({
      where: { kind: 'year_close' },
      select: { number: true, data: true, occurredAt: true },
    }),
  ]);
  const thisYear = Number(cairoDay(now).slice(0, 4));
  return years.map(({ year }) => {
    const entry = closed.find((c) => (c.data as { year?: number }).year === year);
    return {
      year,
      over: year < thisYear,
      closed: Boolean(entry),
      entryNumber: entry?.number ?? null,
    };
  });
}

/**
 * Closes a finished year: every income and expense balance moves to retained earnings in
 * one entry on the year's last moment, and the books are closed through 31 December. The
 * year's profit and loss report still shows the year (the closing entry is left out).
 * Years close in order; a year closes once.
 */
export async function closeYear(db: Db, input: { year: number; actorUserId: string; now?: Date }) {
  const thisYear = Number(cairoDay(input.now ?? new Date()).slice(0, 4));
  if (!Number.isInteger(input.year) || input.year >= thisYear)
    throw new DomainError('year_not_over', 400);
  return inTransaction(db, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('books_lock'))`;
    const key = `year_close:${input.year}`;
    if (await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } }))
      throw new DomainError('year_already_closed');
    if ((await profitBalances(tx, cairoDayStart(`${input.year}-01-01`))).length > 0)
      throw new DomainError('earlier_year_open');
    const end = yearEnd(input.year);
    const lastDay = `${input.year}-12-31`;
    const balances = await profitBalances(tx, end);
    const lock = await tx.booksLock.findUnique({ where: { id: 'books' } });
    // The closing entry is dated inside the year, so a lock past it is lifted for this one
    // entry and put back (or moved to 31 December) in the same transaction.
    if (lock && lock.lockedBefore > new Date(end.getTime() - 1))
      await tx.booksLock.update({
        where: { id: 'books' },
        data: { lockedBefore: new Date(end.getTime() - 1) },
      });
    const total = balances.reduce((s, b) => s + Number(b.balance), 0);
    const entry = await post(tx, {
      kind: 'year_close',
      idempotencyKey: key,
      occurredAt: new Date(end.getTime() - 1),
      createdById: input.actorUserId,
      memo: `Year end ${input.year}`,
      data: { year: input.year, accounts: balances.length },
      lines: [
        ...balances.map((b) => ({ account: { id: b.account_id }, amount: -Number(b.balance) })),
        { account: { type: 'retained_earnings' as const }, amount: total },
      ],
    });
    const closedThrough =
      lock && lock.closedThrough.toISOString().slice(0, 10) > lastDay
        ? lock.closedThrough.toISOString().slice(0, 10)
        : lastDay;
    const data = {
      closedThrough: new Date(`${closedThrough}T00:00:00Z`),
      lockedBefore: cairoDayStart(addDays(closedThrough, 1)),
      updatedById: input.actorUserId,
    };
    await tx.booksLock.upsert({ where: { id: 'books' }, create: data, update: data });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.year_close',
      entityType: 'ledger_entry',
      entityId: entry?.id ?? key,
      after: { year: input.year, profit: -total, closedThrough },
    });
    return { year: input.year, entryNumber: entry?.number ?? null, profitPiastres: -total };
  });
}

// ─── journal export ────────────────────────────────────────────────────────────

/**
 * Every ledger line between two Cairo days, one row per line with its voucher, account
 * and side: the general journal an auditor reads and any accounting program imports.
 */
export async function journalLines(db: Db, input: { from: string; to: string }) {
  if (!isCalendarDay(input.from) || !isCalendarDay(input.to) || input.to < input.from)
    throw new DomainError('invalid_date', 400);
  const rows = await db.$queryRaw<
    {
      day: string;
      number: number;
      kind: string;
      memo: string | null;
      code: string;
      name_en: string | null;
      name_ar: string | null;
      amount: number;
      store: string | null;
      merchant: string | null;
    }[]
  >`
    SELECT to_char(l.occurred_at AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD') AS day,
      e.number, e.kind, e.memo, a.code,
      COALESCE(a.name_en, m.name, s.name_en, u.name, sup.name) AS name_en,
      COALESCE(a.name_ar, m.name, s.name_ar, u.name, sup.name) AS name_ar,
      l.amount_piastres AS amount, ds.code AS store, lm.name AS merchant
    FROM ledger_lines l
      JOIN ledger_entries e ON e.id = l.entry_id
      JOIN ledger_accounts a ON a.id = l.account_id
      LEFT JOIN merchants m ON m.id = a.merchant_id
      LEFT JOIN dark_stores s ON s.id = a.dark_store_id
      LEFT JOIN riders r ON r.id = a.rider_id
      LEFT JOIN users u ON u.id = COALESCE(a.user_id, r.user_id)
      LEFT JOIN suppliers sup ON sup.id = a.supplier_id
      LEFT JOIN dark_stores ds ON ds.id = l.dark_store_id
      LEFT JOIN merchants lm ON lm.id = l.merchant_id
    WHERE l.occurred_at >= ${cairoDayStart(input.from)}
      AND l.occurred_at < ${cairoDayStart(addDays(input.to, 1))}
    ORDER BY e.number, l.amount_piastres DESC`;
  return rows.map((r) => ({
    day: r.day,
    number: r.number,
    kind: r.kind,
    memo: r.memo ?? '',
    code: r.code,
    nameEn: r.name_en ?? '',
    nameAr: r.name_ar ?? r.name_en ?? '',
    debitPiastres: r.amount > 0 ? r.amount : 0,
    creditPiastres: r.amount < 0 ? -r.amount : 0,
    store: r.store ?? '',
    merchant: r.merchant ?? '',
  }));
}

/** Receipt photos attached to entries between two Cairo days (for the audit pack). */
export async function receiptPhotos(db: Db, input: { from: string; to: string }) {
  return db.$queryRaw<{ number: number; photo_id: string; content_type: string; data: Buffer }[]>`
    SELECT e.number, p.id AS photo_id, p.content_type, p.data
    FROM finance_receipts r
      JOIN photos p ON p.id = r.photo_id
      JOIN ledger_entries e ON e.id = COALESCE(
        r.entry_id,
        (SELECT q.entry_id FROM finance_requests q WHERE q.id = r.request_id),
        (SELECT x.id FROM ledger_entries x WHERE x.data->>'payoutId' = r.payout_id LIMIT 1))
    WHERE e.occurred_at >= ${cairoDayStart(input.from)}
      AND e.occurred_at < ${cairoDayStart(addDays(input.to, 1))}
    ORDER BY e.number`;
}
