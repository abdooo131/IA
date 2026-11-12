import {
  addDays,
  cairoDay,
  cairoDayStart,
  rankSuggestions,
  shiftDayByMonths,
} from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  balanceSheet,
  bankMatching,
  bulkApprovePayouts,
  closeBooks,
  drillReport,
  ensureDefaultAccounts,
  importStatement,
  ledgerLinesGaps,
  ledgerLinesList,
  markPayoutsPaid,
  matchBankLines,
  payoutRun,
  post,
  prepareDuePayouts,
  profitAndLoss,
  recordCapital,
  recordExpense,
  reopenBankLine,
  submitExpense,
  trialBalance,
} from '../src/finance';
import { monthEndChecklist } from '../src/finance/cash-control';
import { setSetting } from '../src/settings';
import { createFixture, prisma, readyToPay, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let other: string;
let n = 0;
const key = () => `uxb-${++n}-${Math.random()}`;
const byKey = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });
const today = () => cairoDay(new Date());
const scope = () => ({ userId: admin, storeIds: null, merchantIds: null });

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  admin = (
    await prisma.user.create({
      data: { email: 'a@t.eg', name: 'Admin', role: 'admin', passwordHash: 'x' },
    })
  ).id;
  other = (
    await prisma.user.create({
      data: { email: 'b@t.eg', name: 'Second', role: 'finance', passwordHash: 'x' },
    })
  ).id;
  await ensureDefaultAccounts(prisma);
});

afterAll(() => prisma.$disconnect());

/** A fee for a merchant in a store on a day (revenue against the merchant's wallet). */
async function fee(day: string, amount: number, store: string, merchant = f.merchant.id) {
  await post(prisma, {
    kind: 'order_fee',
    idempotencyKey: key(),
    occurredAt: new Date(cairoDayStart(day).getTime() + 3600_000),
    darkStoreId: store,
    merchantId: merchant,
    lines: [
      { account: { type: 'merchant', merchantId: merchant }, amount },
      { account: { type: 'revenue' }, amount: -amount },
    ],
  });
}

/** COD collected for a merchant: the merchant is owed it. */
async function owe(merchantId: string, amount: number, day = addDays(today(), -2)) {
  await post(prisma, {
    kind: 'cod_collected',
    idempotencyKey: key(),
    occurredAt: new Date(`${day}T10:00:00Z`),
    lines: [
      { account: { type: 'bank' }, amount },
      { account: { type: 'merchant', merchantId }, amount: -amount },
    ],
  });
}

describe('reports you can click into', () => {
  it('keeps the report figures and the drill down lines add up to each report line', async () => {
    // Today and the first day of last month: inside "this month" and its previous period.
    const day = today();
    const lastMonthDay = shiftDayByMonths(`${today().slice(0, 7)}-01`, -1);
    await fee(day, 10_000, f.store.id);
    await fee(day, 2_500, f.other.id);
    await fee(lastMonthDay, 4_000, f.store.id);
    await recordCapital(prisma, {
      direction: 'in',
      moneyAccountId: (await byKey('bank')).id,
      amountPiastres: 100_000,
      reference: 'Owner',
      day: addDays(day, -1),
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await recordExpense(prisma, {
      expenseAccountId: (await byKey('expense:rent')).id,
      paidFromAccountId: (await byKey('bank')).id,
      amountPiastres: 3_000,
      reference: 'Rent',
      memo: 'Rent',
      day,
      darkStoreId: f.store.id,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    const from = `${today().slice(0, 7)}-01`;
    const to = today();
    const pl = await drillReport(prisma, 'profit_and_loss', { from, to });
    const plain = await profitAndLoss(prisma, cairoDayStart(from), cairoDayStart(addDays(to, 1)));
    expect(pl.result.amountPiastres).toBe(plain.profitPiastres);
    expect(pl.sections[0]!.totalPiastres).toBe(12_500);
    expect(pl.result.amountPiastres).toBe(12_500 - 3_000);

    // Every line drills into ledger lines whose net is the line's figure.
    for (const section of pl.sections)
      for (const line of section.lines) {
        const list = await ledgerLinesList(
          prisma,
          { account: line.accountId!, from, to, report: 'profit_and_loss' },
          { all: '1' },
          scope(),
        );
        const natural = list.meta.naturalDebit ? list.totals.net! : 0 - list.totals.net!;
        expect(natural).toBe(line.amountPiastres);
      }

    // A store filter keeps only that store's lines, in the report and the drill down.
    const store = await drillReport(prisma, 'profit_and_loss', { from, to, storeId: f.store.id });
    expect(store.sections[0]!.totalPiastres).toBe(10_000);
    const revenue = await byKey('revenue');
    const storeLines = await ledgerLinesList(
      prisma,
      { account: revenue.id, from, to, store: f.store.id },
      {},
      scope(),
    );
    expect(storeLines.totals.credit).toBe(10_000);
    // Grouped by store: one group per store with its subtotal.
    const grouped = await ledgerLinesList(
      prisma,
      { account: revenue.id, from, to },
      { g: 'store' },
      scope(),
    );
    expect(grouped.groups!.map((g) => g.totals.credit).sort()).toEqual([10_000, 2_500].sort());

    // Comparison with the previous period: last month's fee shows beside this month's.
    const cmp = await drillReport(prisma, 'profit_and_loss', { from, to, compare: 'previous' });
    expect(cmp.compare?.from).toBe(`${addDays(from, -1).slice(0, 7)}-01`);
    const rev = cmp.sections[0]!.lines.find((l) => l.accountId === revenue.id)!;
    expect(rev.amountPiastres).toBe(12_500);
    expect(rev.compareAmountPiastres).toBe(4_000);
    expect(cmp.sections[0]!.compareTotalPiastres).toBe(4_000);

    // Balance sheet and trial balance keep their figures and drill down the same way.
    const bs = await drillReport(prisma, 'balance_sheet', { from, to });
    const plainBs = await balanceSheet(prisma, to);
    expect(bs.sections[0]!.totalPiastres).toBe(plainBs.totalAssetsPiastres);
    expect(bs.result.amountPiastres).toBe(0);
    for (const line of bs.sections.flatMap((s) => s.lines)) {
      if (line.code === 'earnings') continue;
      const list = await ledgerLinesList(
        prisma,
        line.accountId ? { account: line.accountId, to } : { group: line.walletGroup!, to },
        { all: '1' },
        scope(),
      );
      const natural = list.meta.naturalDebit ? list.totals.net! : 0 - list.totals.net!;
      expect(natural).toBe(line.amountPiastres);
    }
    const tb = await drillReport(prisma, 'trial_balance', { from, to });
    const plainTb = await trialBalance(prisma, cairoDayStart(from), cairoDayStart(addDays(to, 1)));
    expect(tb.totals).toEqual({
      debitPiastres: plainTb.totalDebitPiastres,
      creditPiastres: plainTb.totalCreditPiastres,
    });
    expect(ledgerLinesGaps()).toEqual([]);
  });

  it('profit per store clicks through to the income and cost lines of that store', async () => {
    const day = addDays(today(), -1);
    await fee(day, 7_000, f.store.id);
    await fee(day, 1_000, f.other.id);
    const list = await ledgerLinesList(
      prisma,
      { set: 'income_costs', from: day, to: day, store: f.store.id },
      {},
      scope(),
    );
    expect(0 - list.totals.net!).toBe(7_000);
    // Limited people see only their stores' lines.
    const limited = await ledgerLinesList(
      prisma,
      { set: 'income_costs', from: day, to: day },
      {},
      { userId: admin, storeIds: [f.other.id], merchantIds: null },
    );
    expect(0 - limited.totals.net!).toBe(1_000);
  });
});

describe('bank matching', () => {
  it('ranks suggestions: same amount same day, within three days, sums, then near amounts', () => {
    const bank = { day: '2026-10-10', amountPiastres: 50_000 };
    const s = rankSuggestions(bank, [
      { id: 'far', day: '2026-10-01', amountPiastres: 50_000 },
      { id: 'two', day: '2026-10-12', amountPiastres: 50_000 },
      { id: 'same', day: '2026-10-10', amountPiastres: 50_000 },
      { id: 'a', day: '2026-10-09', amountPiastres: 30_000 },
      { id: 'b', day: '2026-10-09', amountPiastres: 20_000 },
      { id: 'near', day: '2026-10-10', amountPiastres: 49_000 },
      { id: 'out', day: '2026-10-10', amountPiastres: -50_000 },
    ]);
    expect(s.map((x) => [x.reason, x.ids.join('+')])).toEqual([
      ['same_day', 'same'],
      ['within_3_days', 'two'],
      ['sum', 'a+b'],
      ['same_amount', 'far'],
      ['near_amount', 'near'],
    ]);
    expect(s.filter((x) => x.matchable).length).toBe(4);
  });

  it('matches one bank line to several ledger lines that add up exactly, and undoes it', async () => {
    const cib = await byKey('bank');
    const day = addDays(today(), -4);
    for (const amount of [30_000, 20_000])
      await recordCapital(prisma, {
        direction: 'in',
        moneyAccountId: cib.id,
        amountPiastres: amount,
        reference: 'Owner',
        day,
        actorUserId: admin,
        idempotencyKey: key(),
      });
    await importStatement(prisma, {
      accountId: cib.id,
      fileName: 'cib.csv',
      lines: [{ day: addDays(day, 1), description: 'Deposit', amountPiastres: 50_000 }],
      actorUserId: admin,
    });
    const view = await bankMatching(prisma, { accountId: cib.id });
    expect(view.lines).toHaveLength(1);
    expect(view.statement).toMatchObject({ total: 1, done: 0 });
    const top = view.lines[0]!.suggestions[0]!;
    expect(top.reason).toBe('sum');
    // Lines that do not add up are refused.
    await expect(
      matchBankLines(prisma, {
        bankLineId: view.lines[0]!.id,
        ledgerLineIds: [top.ids[0]!],
        actorUserId: admin,
      }),
    ).rejects.toMatchObject({ code: 'amounts_differ' });
    await matchBankLines(prisma, {
      bankLineId: view.lines[0]!.id,
      ledgerLineIds: top.ids,
      actorUserId: admin,
    });
    const after = await bankMatching(prisma, { accountId: cib.id });
    expect(after.lines).toHaveLength(0);
    expect(after.statement).toMatchObject({ total: 1, done: 1 });
    // Both ledger lines are proven: none is left to pick from.
    expect(after.openLines).toHaveLength(0);
    // No money was created by matching: the bank holds what the books say.
    expect(await prisma.ledgerEntry.count()).toBe(2);
    // Undo frees both lines.
    await reopenBankLine(prisma, { bankLineId: view.lines[0]!.id, actorUserId: admin });
    expect(await prisma.bankLineMatch.count()).toBe(0);
    const reopened = await bankMatching(prisma, { accountId: cib.id });
    expect(reopened.openLines).toHaveLength(2);
    expect(reopened.lines[0]!.suggestions[0]!.reason).toBe('sum');
  });
});

describe('pay merchants run', () => {
  it('prepares, approves (never one’s own), pays with one reference, and is safe to repeat', async () => {
    await setSetting(prisma, {
      key: 'finance.approval_threshold_piastres',
      value: 100_000,
      actorUserId: admin,
    });
    const small = f.merchant;
    const big = await prisma.merchant.create({
      data: { name: 'Big', payoutSchedule: 'daily', iban: `EG${'1'.repeat(27)}` },
    });
    await prisma.merchant.update({
      where: { id: small.id },
      data: { payoutSchedule: 'daily', bankName: 'CIB', bankAccountNumber: '123' },
    });
    await owe(small.id, 50_000);
    await owe(big.id, 200_000);
    const cutoffDay = addDays(today(), -1);

    let run = await payoutRun(prisma, { userId: admin, cutoffDay });
    expect(run.current).toBe('prepare');
    expect(run.due.filter((d) => d.state === 'ready')).toHaveLength(2);

    const prepared = await prepareDuePayouts(prisma, { cutoffDay, actorUserId: admin });
    expect(prepared.created).toHaveLength(2);
    run = await payoutRun(prisma, { userId: admin, cutoffDay });
    expect(run.current).toBe('approve');
    // Right after preparing, only preparing (and the review: bank details are there) is done.
    expect(run.done).toMatchObject({
      prepare: true,
      review: true,
      approve: false,
      file: false,
      pay: false,
    });
    const bigDraft = run.drafts.find((d) => d.merchantId === big.id)!;
    const smallDraft = run.drafts.find((d) => d.merchantId === small.id)!;
    expect(bigDraft).toMatchObject({ needsApproval: true, mine: true, ready: false });
    expect(smallDraft).toMatchObject({ needsApproval: false, ready: true });

    // The person who prepared cannot approve; below the limit needs no approval.
    const mine = await bulkApprovePayouts(prisma, { ids: [bigDraft.id], actorUserId: admin });
    expect(mine.results[0]).toMatchObject({ ok: false, error: 'same_person' });
    const notNeeded = await bulkApprovePayouts(prisma, {
      ids: [smallDraft.id],
      actorUserId: other,
    });
    expect(notNeeded.results[0]).toMatchObject({ ok: false, error: 'approval_not_needed' });
    await bulkApprovePayouts(prisma, { ids: [bigDraft.id], actorUserId: other });
    run = await payoutRun(prisma, { userId: admin, cutoffDay });
    expect(run.current).toBe('file');
    // Approved, but nothing paid yet: the bank file and mark paid are not ticked.
    expect(run.done).toMatchObject({ approve: true, file: false, pay: false });
    expect(run.totals.readyCount).toBe(2);
    expect(run.totals.readyPiastres).toBe(250_000);

    const ids = run.drafts.map((d) => d.id);
    for (const id of ids) await readyToPay(id, { uploaderId: admin, viewerId: other });
    const paid = await markPayoutsPaid(prisma, {
      ids,
      reference: 'CIB-BULK-1',
      day: today(),
      actorUserId: admin,
    });
    expect(paid.results.every((r) => r.ok)).toBe(true);
    const again = await markPayoutsPaid(prisma, {
      ids,
      reference: 'CIB-BULK-1',
      actorUserId: admin,
    });
    expect(again.results.every((r) => r.ok && r.already)).toBe(true);
    expect(await prisma.ledgerEntry.count({ where: { kind: 'merchant_payout' } })).toBe(2);
    run = await payoutRun(prisma, { userId: admin, cutoffDay });
    expect(run.current).toBe('done');
    expect(run.done).toMatchObject({ prepare: true, approve: true, file: true, pay: true });
    expect(run.paid).toHaveLength(2);
    expect(run.totals.paidPiastres).toBe(250_000);
    expect(run.due.every((d) => d.state === 'paid_today')).toBe(true);
  });

  it('leaves merchants below their minimum payout out of the run', async () => {
    await setSetting(prisma, {
      key: 'finance.payout_minimum_piastres',
      value: 100_000,
      actorUserId: admin,
    });
    await prisma.merchant.update({
      where: { id: f.merchant.id },
      data: { payoutSchedule: 'daily' },
    });
    await owe(f.merchant.id, 50_000);
    const run = await payoutRun(prisma, { userId: admin });
    expect(run.due[0]).toMatchObject({ state: 'below_minimum', minimumPiastres: 100_000 });
    expect(run.current).toBe('done');
    const prepared = await prepareDuePayouts(prisma, {
      cutoffDay: addDays(today(), -1),
      actorUserId: admin,
    });
    expect(prepared.skipped[0]!.reason).toBe('below_payout_minimum');
  });
});

describe('close the month run', () => {
  it('closes through the existing lock: only days over, reopening admin only with a reason', async () => {
    const month = addDays(`${today().slice(0, 7)}-01`, -1).slice(0, 7);
    const list = await monthEndChecklist(prisma, month);
    expect(list.items.at(-1)!.id).toBe('books_closed');
    await expect(
      closeBooks(prisma, { day: today(), actorUserId: admin, actorRole: 'admin' }),
    ).rejects.toMatchObject({ code: 'day_not_over' });
    await closeBooks(prisma, { day: list.lastDay, actorUserId: admin, actorRole: 'finance' });
    const closed = await monthEndChecklist(prisma, month);
    expect(closed.items.find((i) => i.id === 'books_closed')!.done).toBe(true);
    await expect(
      closeBooks(prisma, {
        day: addDays(list.lastDay, -1),
        actorUserId: admin,
        actorRole: 'finance',
        reason: 'fix a bill',
      }),
    ).rejects.toMatchObject({ code: 'reopen_admin_only' });
  });
});

describe('record an expense', () => {
  it('posts below the limit and waits for a second person from it', async () => {
    const cib = await byKey('bank');
    await recordCapital(prisma, {
      direction: 'in',
      moneyAccountId: cib.id,
      amountPiastres: 5_000_000,
      reference: 'Owner',
      day: addDays(today(), -1),
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await setSetting(prisma, {
      key: 'finance.approval_threshold_piastres',
      value: 1_000_000,
      actorUserId: admin,
    });
    const base = {
      expenseAccountId: (await byKey('expense:rent')).id,
      paidFromAccountId: cib.id,
      reference: 'Quick',
      memo: 'Office water',
      vatPiastres: 1_400,
      darkStoreId: f.store.id,
      actorUserId: admin,
    };
    const small = await submitExpense(prisma, {
      ...base,
      amountPiastres: 11_400,
      idempotencyKey: key(),
    });
    expect(small.status).toBe('posted');
    const big = await submitExpense(prisma, {
      ...base,
      amountPiastres: 2_000_000,
      idempotencyKey: key(),
    });
    expect(big.status).toBe('pending');
  });
});
