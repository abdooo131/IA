import { addDays, cairoDay, cairoDayStart } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  balanceOf,
  closeYear,
  decideFinanceRequest,
  drillReport,
  ensureDefaultAccounts,
  giveAdvance,
  ledgerLinesList,
  post,
  recordCapital,
  recordExpense,
  recordJournalEntry,
  submitJournalEntry,
  submitPayroll,
  transferMoney,
} from '../src/finance';
import { setSalary } from '../src/hr-pay';
import { createFixture, prisma, resetDatabase } from './helpers';

// Regression tests for accounting controls: payroll asked again after a rejection, staff
// advance wallets kept out of journal entries, journal entries checked before they wait for
// approval, backdated money out, and the balance sheet's earnings drill down after a year end.

let f: Awaited<ReturnType<typeof createFixture>>;
let alice: string;
let bob: string;
let n = 0;
const key = () => `fx-${++n}-${Math.random()}`;
const byKey = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });
const today = () => cairoDay(new Date());

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  const user = (email: string, name: string) =>
    prisma.user.create({ data: { email, name, role: 'finance', passwordHash: 'x' } });
  alice = (await user('alice@t.eg', 'Alice')).id;
  bob = (await user('bob@t.eg', 'Bob')).id;
  await ensureDefaultAccounts(prisma);
  // 10,000 EGP and above needs a second person.
  await prisma.setting.create({
    data: { key: 'finance.approval_threshold_piastres', scope: 'global', value: 1_000_000 },
  });
  await recordCapital(prisma, {
    direction: 'in',
    moneyAccountId: (await byKey('bank')).id,
    amountPiastres: 5_000_000,
    reference: 'Owner deposit',
    actorUserId: alice,
    idempotencyKey: key(),
  });
});

afterAll(() => prisma.$disconnect());

describe('payroll after a rejection', () => {
  it('asks again with corrected lines, and posts the month once when approved', async () => {
    const cib = await byKey('bank');
    const mona = await prisma.user.create({
      data: {
        email: 'm@t.eg',
        name: 'Mona',
        role: 'store_staff',
        passwordHash: 'x',
        darkStoreId: f.store.id,
      },
    });
    await setSalary(prisma, {
      userId: mona.id,
      monthlyPiastres: 2_000_000,
      insuredWagePiastres: 1_200_000,
      actorUserId: alice,
    });
    const month = addDays(today(), -35).slice(0, 7);
    const first = await submitPayroll(prisma, {
      month,
      moneyAccountId: cib.id,
      lines: [{ userId: mona.id }],
      actorUserId: alice,
    });
    expect(first.status).toBe('pending');
    const firstId = first.status === 'pending' ? first.request.id : '';
    await decideFinanceRequest(prisma, {
      requestId: firstId,
      approve: false,
      note: 'Bonus missing',
      actorUserId: bob,
    });

    const second = await submitPayroll(prisma, {
      month,
      moneyAccountId: cib.id,
      lines: [{ userId: mona.id, bonusPiastres: 100_000 }],
      actorUserId: alice,
    });
    expect(second.status).toBe('pending');
    const request = second.status === 'pending' ? second.request : null;
    expect(request!.id).not.toBe(firstId);
    expect(request!.status).toBe('pending');
    // Sending the same month again while it waits gives back the waiting request.
    const again = await submitPayroll(prisma, {
      month,
      moneyAccountId: cib.id,
      lines: [{ userId: mona.id, bonusPiastres: 100_000 }],
      actorUserId: alice,
    });
    expect(again.status === 'pending' ? again.request.id : '').toBe(request!.id);

    await decideFinanceRequest(prisma, { requestId: request!.id, approve: true, actorUserId: bob });
    const entries = await prisma.ledgerEntry.findMany({
      where: { idempotencyKey: `payroll:${month}` },
    });
    expect(entries).toHaveLength(1);
    // The corrected lines were paid: the bonus is part of the gross salaries expense.
    const salaries = await prisma.ledgerLine.aggregate({
      where: { entryId: entries[0]!.id, amountPiastres: { gt: 0 } },
      _sum: { amountPiastres: true },
    });
    expect(salaries._sum.amountPiastres).toBeGreaterThanOrEqual(2_100_000);
    await expect(
      submitPayroll(prisma, {
        month,
        moneyAccountId: cib.id,
        lines: [{ userId: mona.id }],
        actorUserId: alice,
      }),
    ).rejects.toThrow('payroll_already_run');
  });
});

describe('journal entries', () => {
  it("never touch a team member's staff advance wallet; store cash boxes stay allowed", async () => {
    const cib = await byKey('bank');
    const sami = await prisma.user.create({
      data: { email: 's@t.eg', name: 'Sami', role: 'store_staff', passwordHash: 'x' },
    });
    await giveAdvance(prisma, {
      userId: sami.id,
      amountPiastres: 50_000,
      moneyAccountId: cib.id,
      reference: 'Advance',
      actorUserId: alice,
      idempotencyKey: key(),
    });
    const advance = await byKey(`staff_advance:${sami.id}`);
    const lines = [
      { accountId: (await byKey('expense:rent')).id, debitPiastres: 50_000, creditPiastres: 0 },
      { accountId: advance.id, debitPiastres: 0, creditPiastres: 50_000 },
    ];
    await expect(
      recordJournalEntry(prisma, {
        lines,
        reason: 'Advance written off',
        actorUserId: alice,
        idempotencyKey: key(),
      }),
    ).rejects.toThrow('wallet_not_allowed');
    await expect(
      submitJournalEntry(prisma, {
        lines,
        reason: 'Advance written off',
        actorUserId: alice,
        idempotencyKey: key(),
      }),
    ).rejects.toThrow('wallet_not_allowed');
    expect(await balanceOf(prisma, { id: advance.id })).toBe(50_000);

    // A store's cash box may take part: cash taken from the bank to the box.
    await post(prisma, {
      kind: 'test',
      idempotencyKey: key(),
      occurredAt: new Date(),
      lines: [
        { account: { type: 'store_cash', darkStoreId: f.store.id }, amount: 1 },
        { account: { id: cib.id }, amount: -1 },
      ],
    });
    const box = await byKey(`store_cash:${f.store.id}`);
    const moved = await recordJournalEntry(prisma, {
      lines: [
        { accountId: box.id, debitPiastres: 10_000, creditPiastres: 0 },
        { accountId: cib.id, debitPiastres: 0, creditPiastres: 10_000 },
      ],
      reason: 'Float for the store',
      actorUserId: alice,
      idempotencyKey: key(),
    });
    expect(moved.id).toBeTruthy();
    expect(await balanceOf(prisma, { id: box.id })).toBe(10_001);
  });

  it('are checked when entered, before they wait for a second person', async () => {
    const cib = await byKey('bank');
    const rent = await byKey('expense:rent');
    // 20,000 EGP out of the bank: above the limit, so a valid one would wait.
    const out = (amount = 2_000_000) => [
      { accountId: rent.id, debitPiastres: amount, creditPiastres: 0 },
      { accountId: cib.id, debitPiastres: 0, creditPiastres: amount },
    ];
    const submitWith = (input: Partial<Parameters<typeof submitJournalEntry>[1]>) =>
      submitJournalEntry(prisma, {
        lines: out(),
        reason: 'Rent for the quarter',
        actorUserId: alice,
        idempotencyKey: key(),
        ...input,
      });
    await expect(
      submitWith({
        lines: [
          { accountId: rent.id, debitPiastres: 2_000_000, creditPiastres: 0 },
          { accountId: cib.id, debitPiastres: 0, creditPiastres: 1_999_999 },
        ],
      }),
    ).rejects.toThrow('not_balanced');
    await expect(submitWith({ reason: 'Rent' })).rejects.toThrow('reason_required');
    await expect(
      submitWith({
        lines: [{ accountId: rent.id, debitPiastres: 0, creditPiastres: 0 }, ...out()],
      }),
    ).rejects.toThrow('invalid_line');
    await post(prisma, {
      kind: 'test',
      idempotencyKey: key(),
      occurredAt: new Date(),
      lines: [
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: 1 },
        { account: { type: 'revenue' }, amount: -1 },
      ],
    });
    const wallet = await byKey(`merchant:${f.merchant.id}`);
    await expect(
      submitWith({
        lines: [
          { accountId: wallet.id, debitPiastres: 2_000_000, creditPiastres: 0 },
          { accountId: cib.id, debitPiastres: 0, creditPiastres: 2_000_000 },
        ],
      }),
    ).rejects.toThrow('wallet_not_allowed');
    await expect(submitWith({ reverseNextMonth: true })).rejects.toThrow(
      'accrual_money_not_allowed',
    );
    await expect(
      submitWith({
        lines: [
          { accountId: 'missing', debitPiastres: 2_000_000, creditPiastres: 0 },
          { accountId: cib.id, debitPiastres: 0, creditPiastres: 2_000_000 },
        ],
      }),
    ).rejects.toThrow('account_not_found');
    await expect(submitWith({ day: addDays(today(), 1) })).rejects.toThrow('future_date');
    expect(await prisma.financeRequest.count()).toBe(0);
    // A good one still waits.
    expect((await submitWith({})).status).toBe('pending');
  });
});

describe('backdated money out', () => {
  it('never leaves a bank short at the movement’s own day or any day after it', async () => {
    const cib = await byKey('bank');
    const petty = await prisma.ledgerAccount.create({
      data: {
        key: 'cash:petty-test',
        code: '1299',
        type: 'cash_box',
        category: 'asset',
        groupCode: 1200,
        nameEn: 'Office cash',
        nameAr: 'خزنة المكتب',
      },
    });
    const rent = (await byKey('expense:rent')).id;
    const expense = (amount: number, day: string) =>
      recordExpense(prisma, {
        expenseAccountId: rent,
        paidFromAccountId: cib.id,
        amountPiastres: amount,
        reference: 'Bill',
        memo: 'Bill',
        day,
        actorUserId: alice,
        idempotencyKey: key(),
      });
    // Today the bank holds 50,000 EGP; three days ago it held nothing.
    await expect(expense(10_000, addDays(today(), -3))).rejects.toThrow('not_enough_money');
    await expect(
      transferMoney(prisma, {
        fromAccountId: cib.id,
        toAccountId: petty.id,
        amountPiastres: 10_000,
        reference: 'Float',
        day: addDays(today(), -3),
        actorUserId: alice,
        idempotencyKey: key(),
      }),
    ).rejects.toThrow('not_enough_money');
    await expect(
      recordJournalEntry(prisma, {
        lines: [
          { accountId: rent, debitPiastres: 10_000, creditPiastres: 0 },
          { accountId: cib.id, debitPiastres: 0, creditPiastres: 10_000 },
        ],
        reason: 'Rent paid last week',
        day: addDays(today(), -3),
        actorUserId: alice,
        idempotencyKey: key(),
      }),
    ).rejects.toThrow('not_enough_money');
    await expect(
      recordCapital(prisma, {
        direction: 'out',
        moneyAccountId: cib.id,
        amountPiastres: 10_000,
        reference: 'Drawings',
        day: addDays(today(), -3),
        actorUserId: alice,
        idempotencyKey: key(),
      }),
    ).rejects.toThrow('not_enough_money');

    // 100 EGP in five days ago, 80 EGP out three days ago: 20 EGP left from then on.
    await recordCapital(prisma, {
      direction: 'in',
      moneyAccountId: cib.id,
      amountPiastres: 10_000,
      reference: 'Owner',
      day: addDays(today(), -5),
      actorUserId: alice,
      idempotencyKey: key(),
    });
    await expense(8_000, addDays(today(), -3));
    // 50 EGP four days ago: the bank held 100 then, but would be 30 EGP short a day later.
    await expect(expense(5_000, addDays(today(), -4))).rejects.toThrow('not_enough_money');
    // 20 EGP fits every day from then on.
    await expense(2_000, addDays(today(), -4));
    expect(await balanceOf(prisma, { id: cib.id }, cairoDayStart(addDays(today(), -2)))).toBe(0);
  });
});

describe("the balance sheet's earnings after a year end", () => {
  it('drills into the income and costs since the last closed year', async () => {
    const lastYear = Number(today().slice(0, 4)) - 1;
    const fee = (at: Date, amount: number) =>
      post(prisma, {
        kind: 'order_fee',
        idempotencyKey: key(),
        occurredAt: at,
        merchantId: f.merchant.id,
        lines: [
          { account: { type: 'merchant', merchantId: f.merchant.id }, amount },
          { account: { type: 'revenue' }, amount: -amount },
        ],
      });
    await fee(new Date(`${lastYear}-06-15T10:00:00Z`), 30_000);
    await fee(new Date(), 7_000);
    await closeYear(prisma, { year: lastYear, actorUserId: alice });

    const earningsOn = async (to: string) => {
      const bs = await drillReport(prisma, 'balance_sheet', { from: `${to.slice(0, 7)}-01`, to });
      return bs.sections.flatMap((s) => s.lines).find((l) => l.code === 'earnings')!;
    };
    const drilled = async (to: string) => {
      const list = await ledgerLinesList(
        prisma,
        { set: 'income_costs', to, report: 'balance_sheet' },
        { all: '1' },
        { userId: alice, storeIds: null, merchantIds: null },
      );
      return 0 - list.totals.net!;
    };
    // Today: only this year's fee is still in earnings, and its lines add up to it.
    expect((await earningsOn(today())).amountPiastres).toBe(7_000);
    expect(await drilled(today())).toBe(7_000);
    // A day inside the closed year: everything up to that day.
    const midYear = `${lastYear}-06-30`;
    expect((await earningsOn(midYear)).amountPiastres).toBe(30_000);
    expect(await drilled(midYear)).toBe(30_000);
  });
});
