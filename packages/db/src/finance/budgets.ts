import type { Prisma } from '@prisma/client';
import {
  type BudgetScope,
  cairoDayStart,
  isEvenSplit,
  QUARTERS,
  quarterMonths,
  quarterOfMonth,
  scaleBudget,
  splitQuarter,
  variancePercentBp,
} from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';

type Tx = Prisma.TransactionClient;

// Budgets planned per quarter, then by month. A quarter's amount is split equally into its
// three months (whole piastres, the last month takes the remainder); a month changed by hand
// (setBudget in period.ts) is marked manual and the quarter is then the sum of its months.
// Rows stay per month, so budget against actual per month keeps working.

const checkYear = (year: number) => {
  if (!Number.isInteger(year) || year < 2020 || year > 2100)
    throw new DomainError('invalid_year', 400);
};

const yearMonths = (year: number) => QUARTERS.flatMap((q) => quarterMonths(year, q));

/** The budget rows of a scope: every row, only company wide ones, or one store's. */
function scopeWhere(scope: BudgetScope): Prisma.BudgetWhereInput {
  if (scope === 'all') return {};
  if (scope === 'company') return { darkStoreId: null };
  return { darkStoreId: scope };
}

async function budgetAccount(tx: Tx, accountId: string) {
  const account = await tx.ledgerAccount.findUnique({ where: { id: accountId } });
  if (!account || !['revenue', 'expense'].includes(account.category))
    throw new DomainError('account_not_found', 404);
  return account;
}

async function checkStore(tx: Tx | Db, storeId: string | null) {
  if (storeId && !(await tx.darkStore.findUnique({ where: { id: storeId } })))
    throw new DomainError('store_not_found', 404);
}

/**
 * Sets a quarter's budget of an income or expense account (for a store, or company wide):
 * its three months get the equal split and lose any change made by hand.
 */
export async function setQuarterBudget(
  db: Db,
  input: {
    year: number;
    quarter: number;
    accountId: string;
    darkStoreId?: string | null;
    amountPiastres: number;
    actorUserId: string;
  },
) {
  checkYear(input.year);
  if (!Number.isInteger(input.quarter) || input.quarter < 1 || input.quarter > 4)
    throw new DomainError('invalid_quarter', 400);
  if (!Number.isSafeInteger(input.amountPiastres) || input.amountPiastres < 0)
    throw new DomainError('invalid_amount', 400);
  return inTransaction(db, async (tx) => {
    const account = await budgetAccount(tx, input.accountId);
    const storeId = input.darkStoreId || null;
    await checkStore(tx, storeId);
    const months = quarterMonths(input.year, input.quarter);
    const amounts = splitQuarter(input.amountPiastres);
    const before = await tx.budget.findMany({
      where: { month: { in: months }, accountId: account.id, darkStoreId: storeId },
    });
    const rows = [];
    for (const [i, month] of months.entries()) {
      const existing = before.find((b) => b.month === month);
      rows.push(
        existing
          ? await tx.budget.update({
              where: { id: existing.id },
              data: {
                amountPiastres: amounts[i]!,
                manual: false,
                updatedById: input.actorUserId,
                updatedAt: new Date(),
              },
            })
          : await tx.budget.create({
              data: {
                month,
                accountId: account.id,
                darkStoreId: storeId,
                amountPiastres: amounts[i]!,
                manual: false,
                updatedById: input.actorUserId,
              },
            }),
      );
    }
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.budget_quarter_set',
      entityType: 'budget',
      entityId: rows[0]!.id,
      before: before.map((b) => ({ month: b.month, amount: b.amountPiastres, manual: b.manual })),
      after: {
        year: input.year,
        quarter: input.quarter,
        account: account.code,
        store: storeId,
        amount: input.amountPiastres,
        months: rows.map((r) => ({ month: r.month, amount: r.amountPiastres })),
      },
    });
    return { months: rows.map((r) => ({ month: r.month, amountPiastres: r.amountPiastres })) };
  });
}

export interface BudgetCell {
  budgetPiastres: number;
  actualPiastres: number;
  /** Better than plan is positive: more income, or less cost */
  variancePiastres: number;
  /** Variance as a share of the budget, null without a budget */
  percentBp: number | null;
}

function cell(category: string, budgetPiastres: number, actualPiastres: number): BudgetCell {
  const variancePiastres =
    category === 'revenue' ? actualPiastres - budgetPiastres : budgetPiastres - actualPiastres;
  return {
    budgetPiastres,
    actualPiastres,
    variancePiastres,
    percentBp: variancePercentBp(variancePiastres, budgetPiastres),
  };
}

/**
 * A year's budget against actual per income and expense account: each month, each quarter
 * (the sum of its months; edited when a month was changed by hand) and the year. The scope
 * is every store and the company wide part together ('all'), only company wide
 * ('company') or one store; lines count the same way (company wide: lines with no store).
 * groupCode keeps one account group (4100 fees, 5400 operating expenses...).
 */
export async function budgetYear(
  db: Db,
  input: { year: number; scope: BudgetScope; groupCode?: number },
) {
  checkYear(input.year);
  const scope = input.scope || 'all';
  if (scope !== 'all' && scope !== 'company') await checkStore(db, scope);
  const months = yearMonths(input.year);
  const storeId = scope === 'all' || scope === 'company' ? null : scope;
  const budgets = await db.budget.findMany({
    where: { month: { in: months }, ...scopeWhere(scope) },
  });
  const accounts = await db.ledgerAccount.findMany({
    where: {
      category: { in: ['revenue', 'expense'] },
      ...(input.groupCode ? { groupCode: input.groupCode } : {}),
      OR: [{ isActive: true }, { id: { in: [...new Set(budgets.map((b) => b.accountId))] } }],
    },
    orderBy: { code: 'asc' },
  });
  const actual = await db.$queryRaw<{ account_id: string; month: string; amount: bigint }[]>`
    SELECT l.account_id,
      to_char((l.occurred_at AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Cairo', 'YYYY-MM') AS month,
      SUM(l.amount_piastres) AS amount
    FROM ledger_lines l
      JOIN ledger_entries e ON e.id = l.entry_id
      JOIN ledger_accounts a ON a.id = l.account_id
    WHERE l.occurred_at >= ${cairoDayStart(`${input.year}-01-01`)}
      AND l.occurred_at < ${cairoDayStart(`${input.year + 1}-01-01`)}
      AND a.category IN ('revenue', 'expense')
      AND e.kind <> 'year_close'
      AND (${scope} = 'all'
        OR (${scope} = 'company' AND l.dark_store_id IS NULL)
        OR l.dark_store_id = ${storeId})
    GROUP BY 1, 2`;
  const actualOf = new Map(actual.map((r) => [`${r.account_id}|${r.month}`, Number(r.amount)]));

  const rows = accounts.map((a) => {
    const monthCells = months.map((month) => {
      const own = budgets.filter((b) => b.accountId === a.id && b.month === month);
      const raw = actualOf.get(`${a.id}|${month}`) ?? 0;
      return {
        month,
        quarter: quarterOfMonth(month),
        manual: own.some((b) => b.manual),
        ...cell(
          a.category,
          own.reduce((s, b) => s + b.amountPiastres, 0),
          a.category === 'revenue' ? -raw : raw,
        ),
      };
    });
    const quarters = QUARTERS.map((q) => {
      const inQ = monthCells.filter((m) => m.quarter === q);
      return {
        quarter: q,
        /** A month was changed by hand after the split */
        edited: inQ.some((m) => m.manual),
        /** The months are not the equal split of the quarter */
        uneven: !isEvenSplit(inQ.map((m) => m.budgetPiastres)),
        ...cell(
          a.category,
          inQ.reduce((s, m) => s + m.budgetPiastres, 0),
          inQ.reduce((s, m) => s + m.actualPiastres, 0),
        ),
      };
    });
    return {
      accountId: a.id,
      code: a.code,
      groupCode: a.groupCode,
      category: a.category as 'revenue' | 'expense',
      nameEn: a.nameEn ?? '',
      nameAr: a.nameAr ?? a.nameEn ?? '',
      isActive: a.isActive,
      months: monthCells,
      quarters,
      year: cell(
        a.category,
        monthCells.reduce((s, m) => s + m.budgetPiastres, 0),
        monthCells.reduce((s, m) => s + m.actualPiastres, 0),
      ),
    };
  });

  const total = (category: 'revenue' | 'expense') => {
    const list = rows.filter((r) => r.category === category);
    const sum = (pick: (r: (typeof rows)[number]) => BudgetCell) =>
      cell(
        category,
        list.reduce((s, r) => s + pick(r).budgetPiastres, 0),
        list.reduce((s, r) => s + pick(r).actualPiastres, 0),
      );
    return {
      months: months.map((month, i) => ({ month, ...sum((r) => r.months[i]!) })),
      quarters: QUARTERS.map((q, i) => ({ quarter: q, ...sum((r) => r.quarters[i]!) })),
      year: sum((r) => r.year),
    };
  };
  const income = total('revenue');
  const costs = total('expense');
  // Profit: income less costs, better than plan positive.
  const profitCell = (inc: BudgetCell, cost: BudgetCell) =>
    cell(
      'revenue',
      inc.budgetPiastres - cost.budgetPiastres,
      inc.actualPiastres - cost.actualPiastres,
    );
  return {
    year: input.year,
    scope,
    groupCode: input.groupCode ?? null,
    groups: [...new Set(accounts.map((a) => a.groupCode))],
    rows,
    income,
    costs,
    profit: {
      months: months.map((month, i) => ({
        month,
        ...profitCell(income.months[i]!, costs.months[i]!),
      })),
      quarters: QUARTERS.map((q, i) => ({
        quarter: q,
        ...profitCell(income.quarters[i]!, costs.quarters[i]!),
      })),
      year: profitCell(income.year, costs.year),
    },
  };
}

/**
 * Copies one year's budget to another (usually last year's to this year), optionally raised
 * or lowered by a percentage. A quarter whose months were never changed by hand is copied as
 * its (scaled) total split equally again; other months are scaled one by one and stay marked
 * as changed by hand. A target year that already has budget rows in the scope is refused
 * unless replace is set, which deletes them first.
 */
export async function copyBudgetYear(
  db: Db,
  input: {
    fromYear: number;
    toYear: number;
    scope: BudgetScope;
    percentBp: number;
    replace: boolean;
    actorUserId: string;
  },
) {
  checkYear(input.fromYear);
  checkYear(input.toYear);
  if (input.fromYear === input.toYear) throw new DomainError('same_year', 400);
  if (!Number.isInteger(input.percentBp) || input.percentBp < -10_000)
    throw new DomainError('invalid_percent', 400);
  const scope = input.scope || 'all';
  return inTransaction(db, async (tx) => {
    if (scope !== 'all' && scope !== 'company') await checkStore(tx, scope);
    const source = await tx.budget.findMany({
      where: { month: { in: yearMonths(input.fromYear) }, ...scopeWhere(scope) },
    });
    if (source.length === 0) throw new DomainError('budget_year_empty', 409);
    const targetWhere = { month: { in: yearMonths(input.toYear) }, ...scopeWhere(scope) };
    const existing = await tx.budget.count({ where: targetWhere });
    if (existing > 0 && !input.replace) throw new DomainError('budget_year_not_empty', 409);
    const replaced = existing > 0 ? (await tx.budget.deleteMany({ where: targetWhere })).count : 0;

    const groups = new Map<string, typeof source>();
    for (const b of source) {
      const k = `${b.accountId}|${b.darkStoreId ?? ''}|${quarterOfMonth(b.month)}`;
      groups.set(k, [...(groups.get(k) ?? []), b]);
    }
    const data: Prisma.BudgetCreateManyInput[] = [];
    for (const list of groups.values()) {
      const first = list[0]!;
      const { accountId, darkStoreId } = first;
      const quarter = quarterOfMonth(first.month);
      const from = quarterMonths(input.fromYear, quarter);
      const to = quarterMonths(input.toYear, quarter);
      const amounts = from.map((m) => list.find((b) => b.month === m)?.amountPiastres ?? 0);
      const manual = from.map((m) => list.find((b) => b.month === m)?.manual ?? false);
      const even = !manual.some(Boolean);
      const target = even
        ? splitQuarter(
            scaleBudget(
              amounts.reduce((s, a) => s + a, 0),
              input.percentBp,
            ),
          )
        : amounts.map((a) => scaleBudget(a, input.percentBp));
      to.forEach((month, i) => {
        if (!list.some((b) => b.month === from[i]) && !even) return;
        data.push({
          month,
          accountId,
          darkStoreId,
          amountPiastres: target[i]!,
          manual: even ? false : manual[i],
          updatedById: input.actorUserId,
        });
      });
    }
    await tx.budget.createMany({ data });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.budget_copy',
      entityType: 'budget',
      entityId: `year:${input.toYear}`,
      before: { rows: existing },
      after: {
        fromYear: input.fromYear,
        toYear: input.toYear,
        scope,
        percentBp: input.percentBp,
        rows: data.length,
      },
    });
    return { copied: data.length, replaced };
  });
}
