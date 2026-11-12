import { addDays, cairoDay, cairoDayStart } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  balanceOf,
  bookBankCharge,
  budgetVsActual,
  cashFlow,
  cashForecast,
  closeYear,
  ensureDefaultAccounts,
  ignoreBankLine,
  importStatement,
  journalLines,
  matchBankLine,
  post,
  profitAndLoss,
  reconciliation,
  recordCapital,
  recordExpense,
  setBudget,
  vatReport,
} from '../src/finance';
import { createFixture, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let n = 0;
const key = () => `bank-${++n}-${Math.random()}`;
const byKey = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });
const today = () => cairoDay(new Date());

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

describe('bank reconciliation', () => {
  it('matches statement lines to the books and lists what is left on each side', async () => {
    const cib = await byKey('bank');
    const day = addDays(today(), -5);
    await recordCapital(prisma, {
      direction: 'in',
      moneyAccountId: cib.id,
      amountPiastres: 1_000_000,
      reference: 'Owner',
      day,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await recordExpense(prisma, {
      expenseAccountId: (await byKey('expense:rent')).id,
      paidFromAccountId: cib.id,
      amountPiastres: 200_000,
      reference: 'Rent',
      memo: 'Rent',
      day: addDays(day, 1),
      actorUserId: admin,
      idempotencyKey: key(),
    });
    // In the books only: a cheque the bank has not cleared.
    await recordExpense(prisma, {
      expenseAccountId: (await byKey('expense:other')).id,
      paidFromAccountId: cib.id,
      amountPiastres: 30_000,
      reference: 'Cheque 12',
      memo: 'Cheque',
      day: addDays(day, 2),
      actorUserId: admin,
      idempotencyKey: key(),
    });
    const lines = [
      { day, description: 'Transfer in', amountPiastres: 1_000_000, balancePiastres: 1_000_000 },
      // Two days later than the books: still matched.
      {
        day: addDays(day, 3),
        description: 'Rent',
        amountPiastres: -200_000,
        balancePiastres: 800_000,
      },
      {
        day: addDays(day, 3),
        description: 'Bank fees',
        amountPiastres: -1_500,
        balancePiastres: 798_500,
      },
      {
        day: addDays(day, 4),
        description: 'Reversed',
        amountPiastres: -999,
        balancePiastres: 797_501,
      },
    ];
    const first = await importStatement(prisma, {
      accountId: cib.id,
      fileName: 'cib-oct.xlsx',
      lines,
      actorUserId: admin,
    });
    expect(first).toMatchObject({ imported: 4, skipped: 0, matched: 2 });
    // The same file again adds nothing.
    const again = await importStatement(prisma, {
      accountId: cib.id,
      fileName: 'cib-oct.xlsx',
      lines,
      actorUserId: admin,
    });
    expect(again).toMatchObject({ imported: 0, skipped: 4 });

    let rec = await reconciliation(prisma, { accountId: cib.id });
    expect(rec.bankOnly.map((l) => l.description)).toEqual(['Bank fees', 'Reversed']);
    expect(rec.booksOnly.map((l) => l.amountPiastres)).toEqual([-30_000]);
    expect(rec.bookBalancePiastres).toBe(770_000);
    expect(rec.bankBalancePiastres).toBe(797_501);

    // The bank fee becomes a bank charges expense and matches by itself.
    const fee = rec.bankOnly.find((l) => l.description === 'Bank fees')!;
    await bookBankCharge(prisma, { bankLineId: fee.id, actorUserId: admin });
    expect(await balanceOf(prisma, { id: (await byKey('expense:bank_charges')).id })).toBe(1_500);
    const reversed = rec.bankOnly.find((l) => l.description === 'Reversed')!;
    await expect(
      ignoreBankLine(prisma, { bankLineId: reversed.id, note: 'no', actorUserId: admin }),
    ).rejects.toThrow('note_required');
    await ignoreBankLine(prisma, {
      bankLineId: reversed.id,
      note: 'Bank error, reversed next day',
      actorUserId: admin,
    });
    rec = await reconciliation(prisma, { accountId: cib.id });
    expect(rec.bankOnly).toHaveLength(0);
    expect(rec.matched).toBe(3);
    await expect(
      matchBankLine(prisma, {
        bankLineId: reversed.id,
        ledgerLineId: rec.booksOnly[0]!.id,
        actorUserId: admin,
      }),
    ).rejects.toThrow('bank_line_not_open');
  });

  it('refuses statements for accounts that are not banks', async () => {
    await expect(
      importStatement(prisma, {
        accountId: (await byKey('expense:rent')).id,
        fileName: 'x.csv',
        lines: [{ day: today(), description: 'x', amountPiastres: 1 }],
        actorUserId: admin,
      }),
    ).rejects.toThrow('bank_account_not_found');
  });
});

describe('period reports', () => {
  it('reports VAT, budget against actual and cash flow', async () => {
    const cib = await byKey('bank');
    await recordCapital(prisma, {
      direction: 'in',
      moneyAccountId: cib.id,
      amountPiastres: 1_000_000,
      reference: 'Owner',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await post(prisma, {
      kind: 'order_fee',
      idempotencyKey: key(),
      darkStoreId: f.store.id,
      lines: [
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: 11_400 },
        { account: { type: 'revenue' }, amount: -10_000 },
        { account: { type: 'vat_payable' }, amount: -1_400 },
      ],
    });
    const rent = await byKey('expense:rent');
    await recordExpense(prisma, {
      expenseAccountId: rent.id,
      paidFromAccountId: cib.id,
      amountPiastres: 114_000,
      vatPiastres: 14_000,
      reference: 'Rent',
      memo: 'Rent',
      darkStoreId: f.store.id,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    const month = today().slice(0, 7);
    const vat = await vatReport(prisma, Number(month.slice(0, 4)));
    expect(vat.months.find((m) => m.month === month)).toMatchObject({
      outputPiastres: 1_400,
      inputPiastres: 14_000,
      duePiastres: -12_600,
    });

    await setBudget(prisma, {
      month,
      accountId: rent.id,
      darkStoreId: f.store.id,
      amountPiastres: 80_000,
      actorUserId: admin,
    });
    // Setting it again replaces it.
    await setBudget(prisma, {
      month,
      accountId: rent.id,
      darkStoreId: f.store.id,
      amountPiastres: 90_000,
      actorUserId: admin,
    });
    const budget = await budgetVsActual(prisma, { month, darkStoreId: f.store.id });
    expect(budget.rows.find((r) => r.accountId === rent.id)).toMatchObject({
      budgetPiastres: 90_000,
      actualPiastres: 100_000,
      variancePiastres: -10_000,
    });

    const flow = await cashFlow(prisma, {
      from: cairoDayStart(`${month}-01`),
      to: new Date(Date.now() + 60_000),
    });
    expect(flow.closingPiastres - flow.openingPiastres).toBe(1_000_000 - 114_000);
    const financing = flow.sections.find((s) => s.section === 'financing')!;
    expect(financing.netPiastres).toBe(1_000_000);
    const forecast = await cashForecast(prisma);
    expect(forecast.weeks).toHaveLength(4);
    expect(forecast.weeks[0]!.openingPiastres).toBe(886_000);
  });
});

describe('year end', () => {
  it('moves the year profit to retained earnings and keeps the year report readable', async () => {
    const lastYear = Number(today().slice(0, 4)) - 1;
    const inYear = cairoDayStart(`${lastYear}-06-15`);
    await post(prisma, {
      kind: 'order_fee',
      idempotencyKey: key(),
      occurredAt: inYear,
      lines: [
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: 50_000 },
        { account: { type: 'revenue' }, amount: -50_000 },
      ],
    });
    await post(prisma, {
      kind: 'expense',
      idempotencyKey: key(),
      occurredAt: inYear,
      lines: [
        { account: { id: (await byKey('expense:rent')).id }, amount: 20_000 },
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: -20_000 },
      ],
    });
    await expect(closeYear(prisma, { year: lastYear + 1, actorUserId: admin })).rejects.toThrow(
      'year_not_over',
    );
    const result = await closeYear(prisma, { year: lastYear, actorUserId: admin });
    expect(result.profitPiastres).toBe(30_000);
    expect(await balanceOf(prisma, { type: 'retained_earnings' })).toBe(-30_000);
    expect(await balanceOf(prisma, { type: 'revenue' })).toBe(0);
    const pl = await profitAndLoss(
      prisma,
      cairoDayStart(`${lastYear}-01-01`),
      cairoDayStart(`${lastYear + 1}-01-01`),
    );
    expect(pl.profitPiastres).toBe(30_000);
    const lock = await prisma.booksLock.findUniqueOrThrow({ where: { id: 'books' } });
    expect(lock.closedThrough.toISOString().slice(0, 10)).toBe(`${lastYear}-12-31`);
    await expect(closeYear(prisma, { year: lastYear, actorUserId: admin })).rejects.toThrow(
      'year_already_closed',
    );
    const journal = await journalLines(prisma, {
      from: `${lastYear}-01-01`,
      to: `${lastYear}-12-31`,
    });
    const debit = journal.reduce((s, l) => s + l.debitPiastres, 0);
    const credit = journal.reduce((s, l) => s + l.creditPiastres, 0);
    expect(debit).toBe(credit);
    expect(journal.some((l) => l.kind === 'year_close')).toBe(true);
  });
});
