import { addDays, cairoDay } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  accountStatement,
  balanceOf,
  balanceSheet,
  chartOfAccounts,
  createAccount,
  ensureDefaultAccounts,
  listLedgerEntries,
  markPayoutPaid,
  post,
  profitAndLoss,
  recordBankDeposit,
  recordCapital,
  recordExpense,
  recordJournalEntry,
  recordOtherIncome,
  transferMoney,
  trialBalance,
  updateAccount,
  createPayout,
} from '../src/finance';
import { createFixture, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let n = 0;
const key = () => `b-${++n}-${Math.random()}`;
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

const capital = async (moneyAccountId: string, amount: number) =>
  recordCapital(prisma, {
    direction: 'in',
    moneyAccountId,
    amountPiastres: amount,
    reference: 'Owner deposit',
    actorUserId: admin,
    idempotencyKey: key(),
  });

const openBank = (name: string, number: string) =>
  createAccount(prisma, {
    groupCode: 1100,
    nameEn: name,
    nameAr: name,
    bankName: name,
    accountNumber: number,
    actorUserId: admin,
  });

describe('chart of accounts', () => {
  it('starts with CIB at 1101 and the opening accounts, and numbers new ones in sequence', async () => {
    const cib = await byKey('bank');
    expect(cib).toMatchObject({ code: '1101', nameEn: 'CIB', category: 'asset', groupCode: 1100 });
    const nbe = await openBank('NBE', '123456');
    expect(nbe.code).toBe('1102');
    const safe = await createAccount(prisma, {
      groupCode: 1200,
      nameEn: 'Head office safe',
      nameAr: 'خزنة المكتب',
      actorUserId: admin,
    });
    expect(safe.code).toBe('1201');
    const fuel = await createAccount(prisma, {
      groupCode: 5400,
      nameEn: 'Phone bills',
      nameAr: 'فواتير موبايل',
      actorUserId: admin,
    });
    expect(fuel.code).toBe('5410');

    // A store's cash box and a merchant wallet get their codes when first used.
    await post(prisma, {
      kind: 'test',
      idempotencyKey: key(),
      lines: [
        { account: { type: 'store_cash', darkStoreId: f.store.id }, amount: 100 },
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: -100 },
      ],
    });
    const chart = await chartOfAccounts(prisma);
    expect(chart.find((a) => a.code === '1202')).toMatchObject({ wallet: true, money: true });
    expect(chart.find((a) => a.code === '2100-0001')).toMatchObject({
      nameEn: f.merchant.name,
      balancePiastres: 100,
    });
    // Codes are in order.
    const codes = chart.map((a) => a.code);
    expect([...codes].sort()).toEqual(codes);
  });

  it('refuses closed groups, missing bank details, duplicate names and accounts', async () => {
    await expect(
      createAccount(prisma, { groupCode: 2100, nameEn: 'X', nameAr: 'X', actorUserId: admin }),
    ).rejects.toMatchObject({ code: 'group_not_open' });
    await expect(
      createAccount(prisma, { groupCode: 1100, nameEn: 'QNB', nameAr: 'QNB', actorUserId: admin }),
    ).rejects.toMatchObject({ code: 'bank_details_required' });
    await expect(
      createAccount(prisma, {
        groupCode: 5400,
        nameEn: 'rent',
        nameAr: 'إيجار ٢',
        actorUserId: admin,
      }),
    ).rejects.toMatchObject({ code: 'account_name_taken' });
    await openBank('NBE', '123');
    await expect(
      createAccount(prisma, {
        groupCode: 1100,
        nameEn: 'NBE salaries',
        nameAr: 'الأهلي مرتبات',
        bankName: 'NBE',
        accountNumber: '123',
        actorUserId: admin,
      }),
    ).rejects.toMatchObject({ code: 'bank_account_exists' });
  });

  it('closes only empty, unlocked accounts', async () => {
    const nbe = await openBank('NBE', '1');
    const cib = await byKey('bank');
    await expect(
      updateAccount(prisma, { accountId: cib.id, isActive: false, actorUserId: admin }),
    ).rejects.toMatchObject({ code: 'account_locked' });
    await capital(nbe.id, 500);
    await expect(
      updateAccount(prisma, { accountId: nbe.id, isActive: false, actorUserId: admin }),
    ).rejects.toMatchObject({ code: 'account_has_balance' });
    await transferMoney(prisma, {
      fromAccountId: nbe.id,
      toAccountId: cib.id,
      amountPiastres: 500,
      reference: 'Close NBE',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await updateAccount(prisma, { accountId: nbe.id, isActive: false, actorUserId: admin });
    // A closed account takes no new money.
    await expect(capital(nbe.id, 10)).rejects.toMatchObject({ code: 'account_inactive' });
    expect(await prisma.auditLog.count({ where: { action: 'finance.account_update' } })).toBe(1);
  });
});

describe('money movements', () => {
  it('moves cash between bank and cash box, never more than is there', async () => {
    const cib = await byKey('bank');
    const box = await createAccount(prisma, {
      groupCode: 1200,
      nameEn: 'Office safe',
      nameAr: 'خزنة',
      actorUserId: admin,
    });
    await capital(cib.id, 10_000);
    const input = {
      fromAccountId: cib.id,
      toAccountId: box.id,
      amountPiastres: 3_000,
      reference: 'Cash for petty expenses',
      actorUserId: admin,
      idempotencyKey: 'same-transfer',
    };
    const first = await transferMoney(prisma, input);
    const again = await transferMoney(prisma, input);
    expect(again.id).toBe(first.id);
    expect(await balanceOf(prisma, { id: box.id })).toBe(3_000);
    expect(await balanceOf(prisma, { id: cib.id })).toBe(7_000);
    await expect(
      transferMoney(prisma, {
        ...input,
        amountPiastres: 3_001,
        idempotencyKey: key(),
        fromAccountId: box.id,
        toAccountId: cib.id,
      }),
    ).rejects.toMatchObject({ code: 'not_enough_money' });
    await expect(
      transferMoney(prisma, { ...input, toAccountId: cib.id, idempotencyKey: key() }),
    ).rejects.toMatchObject({ code: 'same_account' });
    const rent = await byKey('expense:rent');
    await expect(
      transferMoney(prisma, { ...input, toAccountId: rent.id, idempotencyKey: key() }),
    ).rejects.toMatchObject({ code: 'account_not_found' });
    await expect(
      transferMoney(prisma, { ...input, amountPiastres: 0, idempotencyKey: key() }),
    ).rejects.toMatchObject({ code: 'invalid_amount' });
    await expect(
      transferMoney(prisma, { ...input, day: addDays(today(), 1), idempotencyKey: key() }),
    ).rejects.toMatchObject({ code: 'future_date' });
  });

  it('books an expense with its VAT, from a chosen bank or box', async () => {
    const cib = await byKey('bank');
    await capital(cib.id, 20_000);
    const rent = await byKey('expense:rent');
    await recordExpense(prisma, {
      expenseAccountId: rent.id,
      paidFromAccountId: cib.id,
      amountPiastres: 11_400,
      vatPiastres: 1_400,
      reference: 'Invoice 77',
      memo: 'October rent, Maadi store',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    expect(await balanceOf(prisma, { id: rent.id })).toBe(10_000);
    expect(await balanceOf(prisma, { type: 'vat_payable' })).toBe(1_400);
    expect(await balanceOf(prisma, { id: cib.id })).toBe(8_600);
    const base = {
      expenseAccountId: rent.id,
      paidFromAccountId: cib.id,
      reference: 'x',
      memo: 'bad one',
      actorUserId: admin,
    };
    await expect(
      recordExpense(prisma, { ...base, amountPiastres: 9_000, idempotencyKey: key() }),
    ).rejects.toMatchObject({ code: 'not_enough_money' });
    await expect(
      recordExpense(prisma, {
        ...base,
        amountPiastres: 100,
        vatPiastres: 100,
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ code: 'invalid_vat' });
    await expect(
      recordExpense(prisma, {
        ...base,
        expenseAccountId: cib.id,
        amountPiastres: 100,
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ code: 'expense_account_not_found' });
  });

  it('records owner drawings only from money that exists, and other income', async () => {
    const cib = await byKey('bank');
    await expect(
      recordCapital(prisma, {
        direction: 'out',
        moneyAccountId: cib.id,
        amountPiastres: 1,
        reference: 'Owner',
        actorUserId: admin,
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ code: 'not_enough_money' });
    await capital(cib.id, 5_000);
    await recordCapital(prisma, {
      direction: 'out',
      moneyAccountId: cib.id,
      amountPiastres: 1_000,
      reference: 'Owner',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    const income = await byKey('other_income:general');
    await recordOtherIncome(prisma, {
      incomeAccountId: income.id,
      moneyAccountId: cib.id,
      amountPiastres: 250,
      reference: 'Interest',
      memo: 'Bank interest October',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    expect(await balanceOf(prisma, { id: cib.id })).toBe(4_250);
    expect(
      await balanceOf(prisma, await byKey('equity:drawings').then((a) => ({ id: a.id }))),
    ).toBe(1_000);
  });

  it('takes balanced journal entries only, and keeps merchant wallets out of them', async () => {
    const cib = await byKey('bank');
    const rent = await byKey('expense:rent');
    const other = await byKey('expense:other');
    await capital(cib.id, 1_000);
    await recordExpense(prisma, {
      expenseAccountId: other.id,
      paidFromAccountId: cib.id,
      amountPiastres: 600,
      reference: 'x',
      memo: 'booked to the wrong category',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await recordJournalEntry(prisma, {
      lines: [
        { accountId: rent.id, debitPiastres: 600, creditPiastres: 0 },
        { accountId: other.id, debitPiastres: 0, creditPiastres: 600 },
      ],
      reason: 'Move the bill to rent',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    expect(await balanceOf(prisma, { id: rent.id })).toBe(600);
    expect(await balanceOf(prisma, { id: other.id })).toBe(0);
    const bad = (lines: { accountId: string; debitPiastres: number; creditPiastres: number }[]) =>
      recordJournalEntry(prisma, {
        lines,
        reason: 'testing it',
        actorUserId: admin,
        idempotencyKey: key(),
      });
    await expect(
      bad([
        { accountId: rent.id, debitPiastres: 5, creditPiastres: 0 },
        { accountId: other.id, debitPiastres: 0, creditPiastres: 4 },
      ]),
    ).rejects.toMatchObject({ code: 'not_balanced' });
    await expect(
      bad([
        { accountId: rent.id, debitPiastres: 5, creditPiastres: 5 },
        { accountId: other.id, debitPiastres: 0, creditPiastres: 0 },
      ]),
    ).rejects.toMatchObject({ code: 'invalid_line' });
    await post(prisma, {
      kind: 'test',
      idempotencyKey: key(),
      lines: [
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: 1 },
        { account: { type: 'revenue' }, amount: -1 },
      ],
    });
    const wallet = await byKey(`merchant:${f.merchant.id}`);
    await expect(
      bad([
        { accountId: wallet.id, debitPiastres: 5, creditPiastres: 0 },
        { accountId: other.id, debitPiastres: 0, creditPiastres: 5 },
      ]),
    ).rejects.toMatchObject({ code: 'wallet_not_allowed' });
  });

  it('lets finance choose the bank for deposits and payouts', async () => {
    const nbe = await openBank('NBE', '9');
    await post(prisma, {
      kind: 'test',
      idempotencyKey: key(),
      lines: [
        { account: { type: 'store_cash', darkStoreId: f.store.id }, amount: 2_000 },
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: -2_000 },
      ],
    });
    await recordBankDeposit(prisma, {
      darkStoreId: f.store.id,
      amountPiastres: 2_000,
      reference: 'Slip 4',
      bankAccountId: nbe.id,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    expect(await balanceOf(prisma, { id: nbe.id })).toBe(2_000);
    const payout = await createPayout(prisma, {
      merchantId: f.merchant.id,
      cutoffAt: new Date(Date.now() + 1000),
      actorUserId: admin,
    });
    expect(payout.number).toBe(1);
    await markPayoutPaid(prisma, {
      payoutId: payout.id,
      reference: 'TRX 1',
      bankAccountId: nbe.id,
      actorUserId: admin,
    });
    expect(await balanceOf(prisma, { id: nbe.id })).toBe(0);
    const rent = await byKey('expense:rent');
    await expect(
      recordBankDeposit(prisma, {
        darkStoreId: f.store.id,
        amountPiastres: 1,
        reference: 'x',
        bankAccountId: rent.id,
        actorUserId: admin,
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ code: 'bank_account_not_found' });
  });
});

describe('numbers and reports', () => {
  it('numbers entries without gaps, even when one fails', async () => {
    const cib = await byKey('bank');
    await capital(cib.id, 100);
    await expect(
      transferMoney(prisma, {
        fromAccountId: cib.id,
        toAccountId: cib.id,
        amountPiastres: 1,
        reference: 'x',
        actorUserId: admin,
        idempotencyKey: key(),
      }),
    ).rejects.toBeDefined();
    await capital(cib.id, 100);
    const { rows } = await listLedgerEntries(prisma, {});
    expect(rows.map((r) => r.number)).toEqual(['JV-000002', 'JV-000001']);
  });

  it('gives a statement, trial balance, profit and loss and a balance sheet that agree', async () => {
    const cib = await byKey('bank');
    const rent = await byKey('expense:rent');
    const yesterday = addDays(today(), -1);
    await recordCapital(prisma, {
      direction: 'in',
      moneyAccountId: cib.id,
      amountPiastres: 50_000,
      reference: 'Opening',
      day: yesterday,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await recordExpense(prisma, {
      expenseAccountId: rent.id,
      paidFromAccountId: cib.id,
      amountPiastres: 8_000,
      reference: 'Inv 1',
      memo: 'Rent',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await post(prisma, {
      kind: 'test',
      idempotencyKey: key(),
      lines: [
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: 3_000 },
        { account: { type: 'revenue' }, amount: -3_000 },
      ],
    });

    const from = new Date(Date.now() - 86_400_000 * 3);
    const to = new Date(Date.now() + 60_000);
    const statement = await accountStatement(prisma, cib.id, from, to);
    expect(statement.openingPiastres).toBe(0);
    expect(statement.lines.map((l) => l.balancePiastres)).toEqual([50_000, 42_000]);
    expect(statement.closingPiastres).toBe(42_000);
    expect(statement.lines[1]!.against).toEqual([
      expect.objectContaining({ code: '5401', nameEn: 'Rent' }),
    ]);
    // Opening balance picks up what came before the period.
    const later = await accountStatement(prisma, cib.id, new Date(Date.now() - 3_600_000), to);
    expect(later.openingPiastres).toBe(50_000);

    const trial = await trialBalance(prisma);
    expect(trial.totalDebitPiastres).toBe(trial.totalCreditPiastres);

    const pl = await profitAndLoss(prisma, from, to);
    expect(pl).toMatchObject({
      totalIncomePiastres: 3_000,
      totalExpensesPiastres: 8_000,
      profitPiastres: -5_000,
    });

    const sheet = await balanceSheet(prisma, today());
    expect(sheet.totalAssetsPiastres).toBe(
      sheet.totalLiabilitiesPiastres + sheet.totalEquityPiastres,
    );
    expect(sheet.earningsPiastres).toBe(-5_000);
  });
});
