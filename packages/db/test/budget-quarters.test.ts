import { cairoDay, quarterOfMonth } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  budgetVsActual,
  budgetYear,
  copyBudgetYear,
  ensureDefaultAccounts,
  recordCapital,
  recordExpense,
  setBudget,
  setQuarterBudget,
} from '../src/finance';
import { createFixture, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let n = 0;
const key = () => `bud-${++n}-${Math.random()}`;
const byKey = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  admin = (
    await prisma.user.create({
      data: { email: 'a@t.eg', name: 'Admin', role: 'admin', passwordHash: 'x' },
    })
  ).id;
  await ensureDefaultAccounts(prisma);
});

afterAll(() => prisma.$disconnect());

describe('budgets by quarter', () => {
  it('splits a quarter into its months, the last taking the rounding', async () => {
    const rent = await byKey('expense:rent');
    await setQuarterBudget(prisma, {
      year: 2027,
      quarter: 2,
      accountId: rent.id,
      darkStoreId: f.store.id,
      amountPiastres: 100_000_001,
      actorUserId: admin,
    });
    const rows = await prisma.budget.findMany({
      where: { accountId: rent.id },
      orderBy: { month: 'asc' },
    });
    expect(rows.map((r) => [r.month, r.amountPiastres, r.manual])).toEqual([
      ['2027-04', 33_333_333, false],
      ['2027-05', 33_333_333, false],
      ['2027-06', 33_333_335, false],
    ]);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'finance.budget_quarter_set' },
    });
    expect(audit?.after).toMatchObject({ quarter: 2, amount: 100_000_001 });

    const year = await budgetYear(prisma, { year: 2027, scope: f.store.id });
    const row = year.rows.find((r) => r.accountId === rent.id)!;
    expect(row.quarters[1]).toMatchObject({
      quarter: 2,
      budgetPiastres: 100_000_001,
      edited: false,
      uneven: false,
    });
    expect(row.year.budgetPiastres).toBe(100_000_001);
    expect(row.quarters[0]!.budgetPiastres).toBe(0);
  });

  it('lets a month be changed by hand, the quarter following its months', async () => {
    const rent = await byKey('expense:rent');
    const base = { accountId: rent.id, darkStoreId: f.store.id, actorUserId: admin };
    await setQuarterBudget(prisma, { ...base, year: 2027, quarter: 1, amountPiastres: 300_000 });
    await setBudget(prisma, { ...base, month: '2027-02', amountPiastres: 150_000 });
    let year = await budgetYear(prisma, { year: 2027, scope: f.store.id });
    let row = year.rows.find((r) => r.accountId === rent.id)!;
    expect(row.quarters[0]).toMatchObject({ budgetPiastres: 350_000, edited: true, uneven: true });
    expect(row.months.slice(0, 3).map((m) => [m.budgetPiastres, m.manual])).toEqual([
      [100_000, false],
      [150_000, true],
      [100_000, false],
    ]);
    // Setting the quarter again splits it equally and clears the hand change.
    await setQuarterBudget(prisma, { ...base, year: 2027, quarter: 1, amountPiastres: 90_000 });
    year = await budgetYear(prisma, { year: 2027, scope: f.store.id });
    row = year.rows.find((r) => r.accountId === rent.id)!;
    expect(row.quarters[0]).toMatchObject({ budgetPiastres: 90_000, edited: false });
    expect(row.months.slice(0, 3).map((m) => m.budgetPiastres)).toEqual([30_000, 30_000, 30_000]);
  });

  it('compares quarters and months with actual, per store, company wide and in total', async () => {
    const cib = await byKey('bank');
    const rent = await byKey('expense:rent');
    await recordCapital(prisma, {
      direction: 'in',
      moneyAccountId: cib.id,
      amountPiastres: 1_000_000,
      reference: 'Owner',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    for (const darkStoreId of [f.store.id, undefined]) {
      await recordExpense(prisma, {
        expenseAccountId: rent.id,
        paidFromAccountId: cib.id,
        amountPiastres: 40_000,
        reference: 'Rent',
        memo: 'Rent',
        darkStoreId,
        actorUserId: admin,
        idempotencyKey: key(),
      });
    }
    const month = cairoDay(new Date()).slice(0, 7);
    const yearNo = Number(month.slice(0, 4));
    const q = quarterOfMonth(month);
    await setQuarterBudget(prisma, {
      year: yearNo,
      quarter: q,
      accountId: rent.id,
      darkStoreId: f.store.id,
      amountPiastres: 150_000,
      actorUserId: admin,
    });
    await setQuarterBudget(prisma, {
      year: yearNo,
      quarter: q,
      accountId: rent.id,
      amountPiastres: 30_000,
      actorUserId: admin,
    });
    const store = await budgetYear(prisma, { year: yearNo, scope: f.store.id });
    const r = store.rows.find((x) => x.accountId === rent.id)!;
    const m = r.months.find((x) => x.month === month)!;
    expect(m).toMatchObject({ budgetPiastres: 50_000, actualPiastres: 40_000 });
    expect(m.variancePiastres).toBe(10_000);
    expect(m.percentBp).toBe(2_000);
    expect(r.quarters[q - 1]).toMatchObject({
      budgetPiastres: 150_000,
      actualPiastres: 40_000,
      variancePiastres: 110_000,
    });
    expect(store.costs.year.actualPiastres).toBe(40_000);
    // The month view still reads the same rows.
    const monthly = await budgetVsActual(prisma, { month, darkStoreId: f.store.id });
    expect(monthly.rows.find((x) => x.accountId === rent.id)?.budgetPiastres).toBe(50_000);

    const company = await budgetYear(prisma, { year: yearNo, scope: 'company' });
    expect(company.rows.find((x) => x.accountId === rent.id)!.quarters[q - 1]).toMatchObject({
      budgetPiastres: 30_000,
      actualPiastres: 40_000,
      variancePiastres: -10_000,
      percentBp: -3_333,
    });
    const all = await budgetYear(prisma, { year: yearNo, scope: 'all' });
    expect(all.rows.find((x) => x.accountId === rent.id)!.year).toMatchObject({
      budgetPiastres: 180_000,
      actualPiastres: 80_000,
    });
    expect(all.profit.year.budgetPiastres).toBe(-180_000);

    const fees = await budgetYear(prisma, { year: yearNo, scope: 'all', groupCode: 4100 });
    expect(fees.rows.every((x) => x.groupCode === 4100)).toBe(true);
    expect(fees.rows.some((x) => x.accountId === rent.id)).toBe(false);
  });

  it("copies last year's budget, optionally raised by a percent", async () => {
    const rent = await byKey('expense:rent');
    const base = { accountId: rent.id, darkStoreId: f.store.id, actorUserId: admin };
    await setQuarterBudget(prisma, { ...base, year: 2026, quarter: 1, amountPiastres: 100 });
    await setQuarterBudget(prisma, { ...base, year: 2026, quarter: 3, amountPiastres: 90_000 });
    await setBudget(prisma, { ...base, month: '2026-08', amountPiastres: 50_000 });

    const done = await copyBudgetYear(prisma, {
      fromYear: 2026,
      toYear: 2027,
      scope: f.store.id,
      percentBp: 1_000,
      replace: false,
      actorUserId: admin,
    });
    expect(done).toMatchObject({ copied: 6, replaced: 0 });
    const year = await budgetYear(prisma, { year: 2027, scope: f.store.id });
    const row = year.rows.find((r) => r.accountId === rent.id)!;
    // Q1 untouched by hand: 100 + 10% = 110, split again.
    expect(row.months.slice(0, 3).map((m) => m.budgetPiastres)).toEqual([36, 36, 38]);
    expect(row.quarters[0]!.edited).toBe(false);
    // Q3 changed by hand: each month raised, the hand change kept.
    expect(row.months.slice(6, 9).map((m) => [m.budgetPiastres, m.manual])).toEqual([
      [33_000, false],
      [55_000, true],
      [33_000, false],
    ]);
    expect(row.quarters[2]).toMatchObject({ budgetPiastres: 121_000, edited: true });

    await expect(
      copyBudgetYear(prisma, {
        fromYear: 2026,
        toYear: 2027,
        scope: f.store.id,
        percentBp: 0,
        replace: false,
        actorUserId: admin,
      }),
    ).rejects.toMatchObject({ code: 'budget_year_not_empty' });
    const again = await copyBudgetYear(prisma, {
      fromYear: 2026,
      toYear: 2027,
      scope: f.store.id,
      percentBp: 0,
      replace: true,
      actorUserId: admin,
    });
    expect(again).toMatchObject({ copied: 6, replaced: 6 });
    expect(
      (await budgetYear(prisma, { year: 2027, scope: f.store.id })).costs.year.budgetPiastres,
    ).toBe(110_100);
    await expect(
      copyBudgetYear(prisma, {
        fromYear: 2025,
        toYear: 2027,
        scope: 'all',
        percentBp: 0,
        replace: true,
        actorUserId: admin,
      }),
    ).rejects.toMatchObject({ code: 'budget_year_empty' });
    expect(await prisma.auditLog.count({ where: { action: 'finance.budget_copy' } })).toBe(2);
  });

  it('refuses accounts that are not income or costs', async () => {
    const cib = await byKey('bank');
    await expect(
      setQuarterBudget(prisma, {
        year: 2027,
        quarter: 1,
        accountId: cib.id,
        amountPiastres: 10,
        actorUserId: admin,
      }),
    ).rejects.toMatchObject({ code: 'account_not_found' });
  });
});
