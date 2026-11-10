import { addDays, cairoDay, loanSchedule } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  balanceOf,
  balanceSheet,
  chargeStorageDays,
  closeBooks,
  costTagReport,
  createAccount,
  createCostTag,
  createPayout,
  createSupplier,
  decideFinanceRequest,
  ensureDefaultAccounts,
  listLoans,
  loanDetail,
  loanInstalmentsDue,
  markPayoutPaid,
  merchantProfitability,
  payBill,
  post,
  recordBill,
  recordCapital,
  recordExpense,
  recordJournalEntry,
  revalueForeignBank,
  submitLoan,
  submitLoanPayment,
  transferMoney,
  unitsAtDayEnds,
  updateCostTag,
  bothBalances,
} from '../src/finance';
import { ledgerLinesList } from '../src/finance/drill';
import { submitPettyCash, setPettyCategory } from '../src/finance/cash-control';
import { savePhoto } from '../src/photos';
import { setSetting } from '../src/settings';
import { receive } from '../src/stock';
import { createFixture, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let second: string;
let n = 0;
const key = () => `ltf-${++n}-${Math.random()}`;
const byKey = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });
const today = () => cairoDay(new Date());
const set = (k: Parameters<typeof setSetting>[1]['key'], value: number) =>
  setSetting(prisma, { key: k, value, actorUserId: null });
const scope = () => ({ userId: admin, storeIds: null, merchantIds: null });

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  const user = (email: string) =>
    prisma.user.create({ data: { email, name: email, role: 'admin', passwordHash: 'x' } });
  admin = (await user('a@t.eg')).id;
  second = (await user('b@t.eg')).id;
  await ensureDefaultAccounts(prisma);
  await recordCapital(prisma, {
    direction: 'in',
    moneyAccountId: (await byKey('bank')).id,
    amountPiastres: 10_000_000,
    reference: 'Owner',
    // Far back, so backdated movements in the tests find the money.
    day: addDays(cairoDay(new Date()), -90),
    actorUserId: admin,
    idempotencyKey: key(),
  });
});

afterAll(() => prisma.$disconnect());

describe('loan schedule', () => {
  it('adds up exactly, the last instalment taking the rounding', () => {
    for (const method of ['declining', 'flat'] as const)
      for (const [principal, bp, months] of [
        [100_000_000, 2_250, 36],
        [1_234_567, 1_999, 7],
        [999_999, 0, 12],
        [50_000, 3_600, 1],
      ] as const) {
        const rows = loanSchedule({
          principalPiastres: principal,
          annualRateBp: bp,
          months,
          method,
          firstPaymentDay: '2026-01-31',
        });
        expect(rows).toHaveLength(months);
        expect(rows.reduce((s, r) => s + r.principalPiastres, 0)).toBe(principal);
        expect(rows.at(-1)!.remainingPiastres).toBe(0);
        for (const r of rows) {
          expect(r.instalmentPiastres).toBe(r.principalPiastres + r.interestPiastres);
          expect(Number.isInteger(r.interestPiastres)).toBe(true);
        }
        // Declining balance: equal instalments but the last; interest falls month by month.
        if (method === 'declining' && months > 2) {
          const first = rows[0]!.instalmentPiastres;
          for (const r of rows.slice(0, -1)) expect(r.instalmentPiastres).toBe(first);
          expect(Math.abs(rows.at(-1)!.instalmentPiastres - first)).toBeLessThanOrEqual(months);
          expect(rows[1]!.interestPiastres).toBeLessThanOrEqual(rows[0]!.interestPiastres);
        }
      }
    // 1,000,000 EGP at 22.5% over 36 months: 38,449.60 EGP a month (the annuity formula).
    const annuity = loanSchedule({
      principalPiastres: 100_000_000,
      annualRateBp: 2_250,
      months: 36,
      method: 'declining',
      firstPaymentDay: '2026-01-31',
    });
    expect(annuity[0]!.instalmentPiastres).toBe(3_844_960);
    expect(annuity[0]!.interestPiastres).toBe(1_875_000);
    // Due days keep the day of the month, the last day when a month is shorter.
    expect(annuity.slice(0, 3).map((r) => r.dueDay)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
  });
});

describe('loans', () => {
  const loanInput = async (extra: Record<string, unknown> = {}) => {
    const bank = await createSupplier(prisma, { name: 'NBE', actorUserId: admin });
    return {
      lender: 'supplier' as const,
      supplierId: bank.id,
      principalPiastres: 1_200_000,
      moneyAccountId: (await byKey('bank')).id,
      startDay: addDays(today(), -40),
      annualRateBp: 1_200,
      months: 12,
      firstPaymentDay: addDays(today(), -10),
      reference: 'NBE-77',
      actorUserId: admin,
      idempotencyKey: key(),
      ...extra,
    };
  };

  it('waits for a second person, then books the money in and the schedule', async () => {
    await set('finance.approve_money_in', 1);
    const cib = await byKey('bank');
    const before = await balanceOf(prisma, { id: cib.id });
    const sent = await submitLoan(prisma, await loanInput());
    expect(sent.status).toBe('pending');
    expect(await prisma.loan.count()).toBe(0);
    const request = sent.status === 'pending' ? sent.request : null;
    await expect(
      decideFinanceRequest(prisma, { requestId: request!.id, approve: true, actorUserId: admin }),
    ).rejects.toMatchObject({ code: 'same_person' });
    await decideFinanceRequest(prisma, {
      requestId: request!.id,
      approve: true,
      actorUserId: second,
    });
    const [loan] = await listLoans(prisma);
    expect(loan).toMatchObject({ number: 'LN-000001', owedPiastres: 1_200_000, paid: 0 });
    expect(loan!.account.code).toBe('2701');
    expect(await balanceOf(prisma, { id: cib.id })).toBe(before + 1_200_000);
    // The balance sheet shows what is owed on the loan.
    const sheet = await balanceSheet(prisma, today());
    expect(sheet.liabilities.find((l) => l.code === '2701')?.amountPiastres).toBe(1_200_000);
    // One instalment overdue (10 days ago) and none other within 7 days.
    expect(await loanInstalmentsDue(prisma)).toMatchObject({ count: 1 });
  });

  it('pays instalments in order: principal off the loan, interest to 5904, never more than held', async () => {
    await set('finance.approve_money_in', 0);
    await set('finance.approval_threshold_piastres', 0);
    const posted = await submitLoan(prisma, await loanInput());
    expect(posted.status).toBe('posted');
    const loan = (await listLoans(prisma))[0]!;
    const detail = await loanDetail(prisma, loan.id);
    const first = detail.instalments[0]!;
    expect(first.interestPiastres).toBe(12_000); // 1% a month of 12,000 EGP
    const cib = await byKey('bank');
    const before = await balanceOf(prisma, { id: cib.id });
    const pay = () =>
      submitLoanPayment(prisma, {
        loanId: loan.id,
        moneyAccountId: cib.id,
        reference: 'Transfer',
        actorUserId: admin,
        idempotencyKey: key(),
      });
    await pay();
    await pay();
    const after = await loanDetail(prisma, loan.id);
    expect(after.instalments.filter((i) => i.paidAt).map((i) => i.seq)).toEqual([1, 2]);
    const paid = after.instalments.slice(0, 2);
    expect(await balanceOf(prisma, { id: cib.id })).toBe(
      before - paid.reduce((s, i) => s + i.instalmentPiastres, 0),
    );
    expect(await balanceOf(prisma, { type: 'loan_interest_expense' })).toBe(
      paid.reduce((s, i) => s + i.interestPiastres, 0),
    );
    expect(after.owedPiastres).toBe(1_200_000 - paid.reduce((s, i) => s + i.principalPiastres, 0));
    expect(await balanceOf(prisma, { id: loan.account.id })).toBe(0 - after.owedPiastres);
    expect((await byKey('loan_interest_expense')).code).toBe('5904');

    // A box that does not hold the instalment pays nothing.
    const box = await createAccount(prisma, {
      groupCode: 1200,
      nameEn: 'Office box',
      nameAr: 'خزنة المكتب',
      actorUserId: admin,
    });
    await expect(
      submitLoanPayment(prisma, {
        loanId: loan.id,
        moneyAccountId: box.id,
        reference: 'Cash',
        actorUserId: admin,
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ code: 'not_enough_money' });

    // From the approval limit an instalment waits for a second person.
    await set('finance.approval_threshold_piastres', 50_000);
    const waiting = await pay();
    expect(waiting.status).toBe('pending');
  });
});

describe('cost tags', () => {
  it('tags expense, journal, bill and petty cash lines and totals them per tag', async () => {
    const cib = await byKey('bank');
    const marketing = await byKey('expense:marketing');
    const ramadan = await createCostTag(prisma, {
      nameEn: 'Ramadan campaign',
      nameAr: 'حملة رمضان',
      actorUserId: admin,
    });
    const branch = await createCostTag(prisma, {
      nameEn: 'New branch',
      nameAr: 'فرع جديد',
      actorUserId: admin,
    });
    await expect(
      createCostTag(prisma, { nameEn: 'ramadan CAMPAIGN', nameAr: 'x y', actorUserId: admin }),
    ).rejects.toMatchObject({ code: 'cost_tag_exists' });
    await recordExpense(prisma, {
      expenseAccountId: marketing.id,
      paidFromAccountId: cib.id,
      amountPiastres: 50_000,
      vatPiastres: 5_000,
      reference: 'Ads',
      memo: 'Facebook ads',
      costTagId: ramadan.id,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await recordJournalEntry(prisma, {
      reason: 'Reclassify banner printing',
      lines: [
        { accountId: marketing.id, debitPiastres: 7_000, creditPiastres: 0, costTagId: ramadan.id },
        { accountId: (await byKey('expense:other')).id, debitPiastres: 0, creditPiastres: 7_000 },
      ],
      actorUserId: admin,
      idempotencyKey: key(),
    });
    const printer = await createSupplier(prisma, {
      name: 'Printer',
      defaultExpenseAccountId: (await byKey('expense:maintenance')).id,
      actorUserId: admin,
    });
    await recordBill(prisma, {
      supplierId: printer.id,
      reference: 'P-1',
      billDate: today(),
      dueDate: today(),
      netPiastres: 20_000,
      vatPiastres: 2_800,
      costTagId: branch.id,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    // Petty cash from the store's box, tagged.
    await post(prisma, {
      kind: 'test_cash',
      idempotencyKey: key(),
      lines: [
        { account: { type: 'store_cash', darkStoreId: f.store.id }, amount: 1_000_000 },
        { account: { id: (await byKey('equity:capital')).id }, amount: -1_000_000 },
      ],
    });
    const fuel = await byKey('expense:fuel');
    await setPettyCategory(prisma, { accountId: fuel.id, petty: true, actorUserId: admin });
    const photo = await savePhoto(prisma, {
      kind: 'receipt',
      contentType: 'image/jpeg',
      data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      actorUserId: admin,
    });
    await submitPettyCash(prisma, {
      darkStoreId: f.store.id,
      expenseAccountId: fuel.id,
      amountPiastres: 3_000,
      note: 'Generator fuel',
      photoId: photo.id,
      costTagId: branch.id,
      actorUserId: admin,
      idempotencyKey: key(),
    });

    const report = await costTagReport(prisma, { from: today(), to: today(), compare: 'previous' });
    const r = report.rows.find((x) => x.id === ramadan.id)!;
    const b = report.rows.find((x) => x.id === branch.id)!;
    expect(r.costsPiastres).toBe(45_000 + 7_000);
    expect(r.accounts.map((a) => a.code)).toEqual(['5405']);
    expect(b.costsPiastres).toBe(20_000 + 3_000);
    expect(b.accounts.map((a) => a.code).sort()).toEqual(['5403', '5407']);
    expect(report.totals.costsPiastres).toBe(52_000 + 23_000);
    expect(r.compareCostsPiastres).toBe(0);
    // The drill down with the tag filter adds up to the report's figure.
    const lines = await ledgerLinesList(
      prisma,
      { set: 'income_costs', tag: ramadan.id, from: today(), to: today() },
      { all: '1' },
      scope(),
    );
    expect(lines.totals.net).toBe(52_000);
    expect(lines.rows.every((l) => l.costTag === 'Ramadan campaign')).toBe(true);
    const grouped = await ledgerLinesList(
      prisma,
      { set: 'income_costs', from: today(), to: today() },
      { g: 'tag' },
      scope(),
    );
    expect(grouped.groups!.map((g) => g.key).sort()).toEqual(['-', ramadan.id, branch.id].sort());

    // A tag switched off cannot be chosen again; its lines keep it.
    await updateCostTag(prisma, { costTagId: ramadan.id, isActive: false, actorUserId: admin });
    await expect(
      recordExpense(prisma, {
        expenseAccountId: marketing.id,
        paidFromAccountId: cib.id,
        amountPiastres: 1_000,
        reference: 'Ads',
        memo: 'More ads',
        costTagId: ramadan.id,
        actorUserId: admin,
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ code: 'cost_tag_inactive' });
    expect((await costTagReport(prisma, { from: today(), to: today() })).rows).toHaveLength(2);
  });
});

describe('bank accounts in another currency', () => {
  const usdBank = () =>
    createAccount(prisma, {
      groupCode: 1100,
      nameEn: 'CIB USD',
      nameAr: 'CIB دولار',
      bankName: 'CIB',
      accountNumber: '100200300',
      currency: 'USD',
      actorUserId: admin,
    });

  it('moves money both ways with both amounts and puts the rate change in 5901', async () => {
    const cib = await byKey('bank');
    const usd = await usdBank();
    await expect(
      createAccount(prisma, {
        groupCode: 1200,
        nameEn: 'Dollar box',
        nameAr: 'خزنة دولار',
        currency: 'USD',
        actorUserId: admin,
      }),
    ).rejects.toMatchObject({ code: 'currency_banks_only' });
    // Buy 1,000 USD for 48,500 EGP.
    await transferMoney(prisma, {
      fromAccountId: cib.id,
      toAccountId: usd.id,
      amountPiastres: 4_850_000,
      foreignCents: 100_000,
      reference: 'Buy USD',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    expect(await bothBalances(prisma, usd.id)).toEqual({ piastres: 4_850_000, cents: 100_000 });
    await expect(
      transferMoney(prisma, {
        fromAccountId: cib.id,
        toAccountId: usd.id,
        amountPiastres: 1_000,
        reference: 'No cents',
        actorUserId: admin,
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ code: 'foreign_amount_required' });
    // Sell 400 USD for 20,000 EGP: book value 19,400, gain 600 (credit 5901).
    await transferMoney(prisma, {
      fromAccountId: usd.id,
      toAccountId: cib.id,
      amountPiastres: 2_000_000,
      foreignCents: 40_000,
      reference: 'Sell USD',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    expect(await bothBalances(prisma, usd.id)).toEqual({ piastres: 2_910_000, cents: 60_000 });
    expect(await balanceOf(prisma, { type: 'fx_difference' })).toBe(-60_000);
    await expect(
      transferMoney(prisma, {
        fromAccountId: usd.id,
        toAccountId: cib.id,
        amountPiastres: 1_000,
        foreignCents: 60_001,
        reference: 'Too much',
        actorUserId: admin,
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ code: 'not_enough_money' });

    // A USD bill paid from the USD bank: only the rate difference goes to 5901.
    const aws = await createSupplier(prisma, {
      name: 'AWS',
      defaultExpenseAccountId: (await byKey('expense:utilities')).id,
      actorUserId: admin,
    });
    const bill = await recordBill(prisma, {
      supplierId: aws.id,
      reference: 'AWS-1',
      billDate: today(),
      dueDate: today(),
      currency: 'USD',
      foreignNetCents: 10_000,
      fxRate: '50',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await payBill(prisma, {
      billId: bill.id,
      foreignAmountCents: 10_000,
      moneyAccountId: usd.id,
      reference: 'Wire',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    // 100 USD left the account at its book rate 48.50: 4,850 EGP; the bill was 5,000 EGP.
    expect(await bothBalances(prisma, usd.id)).toEqual({ piastres: 2_425_000, cents: 50_000 });
    expect(await balanceOf(prisma, { type: 'supplier', supplierId: aws.id })).toBe(0);
    expect(await balanceOf(prisma, { type: 'fx_difference' })).toBe(-60_000 - 15_000);
  });

  it('revalues once per account and month at the month end rate', async () => {
    const cib = await byKey('bank');
    const usd = await usdBank();
    const lastMonthDay = addDays(`${today().slice(0, 7)}-01`, -1);
    await transferMoney(prisma, {
      fromAccountId: cib.id,
      toAccountId: usd.id,
      amountPiastres: 4_800_000,
      foreignCents: 100_000,
      reference: 'Buy USD',
      day: lastMonthDay,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    const month = lastMonthDay.slice(0, 7);
    await expect(
      revalueForeignBank(prisma, {
        accountId: usd.id,
        month: today().slice(0, 7),
        fxRate: '50',
        actorUserId: admin,
      }),
    ).rejects.toMatchObject({ code: 'month_not_over' });
    const result = await revalueForeignBank(prisma, {
      accountId: usd.id,
      month,
      fxRate: '50.25',
      actorUserId: admin,
    });
    expect(result).toMatchObject({ foreignCents: 100_000, differencePiastres: 225_000 });
    expect(await bothBalances(prisma, usd.id)).toEqual({ piastres: 5_025_000, cents: 100_000 });
    expect(await balanceOf(prisma, { type: 'fx_difference' })).toBe(-225_000);
    await expect(
      revalueForeignBank(prisma, { accountId: usd.id, month, fxRate: '49', actorUserId: admin }),
    ).rejects.toMatchObject({ code: 'already_revalued' });
    await expect(
      revalueForeignBank(prisma, { accountId: cib.id, month, fxRate: '49', actorUserId: admin }),
    ).rejects.toMatchObject({ code: 'not_foreign_account' });
  });

  it('refuses a foreign bank where only EGP can move', async () => {
    const usd = await usdBank();
    await transferMoney(prisma, {
      fromAccountId: (await byKey('bank')).id,
      toAccountId: usd.id,
      amountPiastres: 4_850_000,
      foreignCents: 100_000,
      reference: 'Buy USD',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    // An expense, a journal entry and a payout cannot take money from it.
    await expect(
      recordExpense(prisma, {
        expenseAccountId: (await byKey('expense:other')).id,
        paidFromAccountId: usd.id,
        amountPiastres: 1_000,
        reference: 'x1',
        memo: 'Something',
        actorUserId: admin,
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ code: 'foreign_currency_account' });
    await expect(
      recordJournalEntry(prisma, {
        reason: 'Move to other',
        lines: [
          { accountId: (await byKey('expense:other')).id, debitPiastres: 1_000, creditPiastres: 0 },
          { accountId: usd.id, debitPiastres: 0, creditPiastres: 1_000 },
        ],
        actorUserId: admin,
        idempotencyKey: key(),
      }),
    ).rejects.toMatchObject({ code: 'foreign_currency_account' });
    await post(prisma, {
      kind: 'test_owed',
      idempotencyKey: key(),
      lines: [
        { account: { id: (await byKey('expense:other')).id }, amount: 5_000 },
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: -5_000 },
      ],
    });
    const payout = await createPayout(prisma, {
      merchantId: f.merchant.id,
      cutoffAt: new Date(),
      actorUserId: admin,
    });
    await expect(
      markPayoutPaid(prisma, {
        payoutId: payout.id,
        reference: 'T1',
        bankAccountId: usd.id,
        actorUserId: second,
      }),
    ).rejects.toMatchObject({ code: 'foreign_currency_account' });
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe(
      'draft',
    );
  });
});

describe('stored units, rent share and the storage catch up', () => {
  it('works out the units at the end of a day from the stock movements', async () => {
    await receive(prisma, { binId: f.shelfA.id, skuId: f.sku.id, quantity: 10 });
    const days = await unitsAtDayEnds(prisma, [addDays(today(), -1), today()]);
    expect(days.get(addDays(today(), -1))).toEqual([]);
    expect(days.get(today())).toEqual([
      { darkStoreId: f.store.id, merchantId: f.merchant.id, units: 10 },
    ]);
  });

  it('shares rent by unit days stored for every merchant, storage paid or not', async () => {
    const other = await prisma.merchant.create({ data: { name: 'All inclusive' } });
    const lastMonthDay = addDays(`${today().slice(0, 7)}-01`, -1);
    const month = lastMonthDay.slice(0, 7);
    // 10 days of 30 units for ours, 10 days of 10 units for the all inclusive merchant (who
    // pays no storage: no storage_fee entry exists at all).
    const rows = [];
    for (let i = 0; i < 10; i++) {
      const day = new Date(`${addDays(lastMonthDay, -i)}T00:00:00Z`);
      rows.push({ darkStoreId: f.store.id, merchantId: f.merchant.id, day, units: 30 });
      rows.push({ darkStoreId: f.store.id, merchantId: other.id, day, units: 10 });
    }
    await prisma.stockUnitDay.createMany({ data: rows });
    await recordExpense(prisma, {
      expenseAccountId: (await byKey('expense:rent')).id,
      paidFromAccountId: (await byKey('bank')).id,
      amountPiastres: 40_000,
      reference: 'Rent',
      memo: 'Store rent',
      darkStoreId: f.store.id,
      day: lastMonthDay,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    const { rows: result } = await merchantProfitability(prisma, { month });
    const ours = result.find((r) => r.merchant.id === f.merchant.id)!;
    const theirs = result.find((r) => r.merchant.id === other.id)!;
    expect(ours.costs.storageSpacePiastres).toBe(30_000);
    expect(theirs.costs.storageSpacePiastres).toBe(10_000);
    expect(theirs.stores[0]).toMatchObject({ unitDays: 100, storeUnitDays: 400 });
    expect(await prisma.ledgerEntry.count({ where: { kind: 'storage_fee' } })).toBe(0);
  });

  it('charges missed days once from their snapshot, up to the cap, skipping closed books', async () => {
    // 3,000 piastres a unit a month; 10 units a day.
    await set('fee.storage_per_unit_month_piastres', 3_000);
    await set('fee.vat_bp', 0);
    const yesterday = addDays(today(), -1);
    const snapshot = async (day: string) =>
      prisma.stockUnitDay.create({
        data: {
          darkStoreId: f.store.id,
          merchantId: f.merchant.id,
          day: new Date(`${day}T00:00:00Z`),
          units: 10,
        },
      });
    // The server last ran four days ago and slept since.
    await prisma.storageDay.create({
      data: { day: new Date(`${addDays(today(), -4)}T00:00:00Z`), charged: 0 },
    });
    for (let i = 1; i <= 3; i++) await snapshot(addDays(today(), -i));
    const run = await chargeStorageDays(prisma);
    expect(run.days).toEqual([addDays(today(), -3), addDays(today(), -2), yesterday]);
    expect(run.charged).toBe(3);
    const keys = (await prisma.ledgerEntry.findMany({ where: { kind: 'storage_fee' } }))
      .map((e) => e.idempotencyKey)
      .sort();
    expect(keys).toHaveLength(3);
    // Running again changes nothing.
    expect(await chargeStorageDays(prisma)).toEqual({ days: [], charged: 0 });
    expect(await prisma.ledgerEntry.count({ where: { kind: 'storage_fee' } })).toBe(3);
  });

  it('stops at storage.catch_up_days and skips days inside closed books', async () => {
    await set('fee.storage_per_unit_month_piastres', 3_000);
    await set('storage.catch_up_days', 4);
    await prisma.storageDay.create({
      data: { day: new Date(`${addDays(today(), -20)}T00:00:00Z`), charged: 0 },
    });
    for (let i = 1; i <= 10; i++)
      await prisma.stockUnitDay.create({
        data: {
          darkStoreId: f.store.id,
          merchantId: f.merchant.id,
          day: new Date(`${addDays(today(), -i)}T00:00:00Z`),
          units: 10,
        },
      });
    // The books are closed through three days ago.
    await closeBooks(prisma, { day: addDays(today(), -3), actorUserId: admin, actorRole: 'admin' });
    const run = await chargeStorageDays(prisma);
    expect(run.days).toEqual([
      addDays(today(), -4),
      addDays(today(), -3),
      addDays(today(), -2),
      addDays(today(), -1),
    ]);
    const charged = await prisma.ledgerEntry.findMany({ where: { kind: 'storage_fee' } });
    expect(charged.map((e) => (e.data as { day: string }).day).sort()).toEqual([
      addDays(today(), -2),
      addDays(today(), -1),
    ]);
    expect(await prisma.storageDay.count()).toBe(5);
  });
});
