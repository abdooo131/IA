import { addDays, cairoDay } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  approvePayout,
  attachReceipt,
  balanceOf,
  booksLock,
  cancelFinanceRequest,
  closeBooks,
  createPayout,
  decideFinanceRequest,
  ensureDefaultAccounts,
  markPayoutPaid,
  missingReceipts,
  post,
  receiptsFor,
  recordCapital,
  recordJournalEntry,
  recordOpeningBalances,
  submitCapitalIn,
  submitDrawings,
  submitExpense,
  submitJournalEntry,
  submitMerchantAdjustment,
} from '../src/finance';
import { savePhoto } from '../src/photos';
import { createFixture, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let alice: string;
let bob: string;
let n = 0;
const key = () => `c-${++n}-${Math.random()}`;
const byKey = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });
const today = () => cairoDay(new Date());
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

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
  const cib = await byKey('bank');
  await recordCapital(prisma, {
    direction: 'in',
    moneyAccountId: cib.id,
    amountPiastres: 5_000_000,
    reference: 'Owner deposit',
    actorUserId: alice,
    idempotencyKey: key(),
  });
});

afterAll(() => prisma.$disconnect());

const expense = async (amount: number, actor = alice, day?: string) =>
  submitExpense(prisma, {
    expenseAccountId: (await byKey('expense:rent')).id,
    paidFromAccountId: (await byKey('bank')).id,
    amountPiastres: amount,
    reference: 'INV-1',
    memo: 'Store rent',
    day,
    actorUserId: actor,
    idempotencyKey: key(),
  });

describe('closing months', () => {
  it('blocks posting on or before the closed day, and only admin reopens with a reason', async () => {
    const yesterday = addDays(today(), -1);
    const twoDaysAgo = addDays(today(), -2);
    // Money in the bank before the backdated expenses below (never spent before it came in).
    await recordCapital(prisma, {
      direction: 'in',
      moneyAccountId: (await byKey('bank')).id,
      amountPiastres: 100_000,
      reference: 'Owner deposit',
      day: addDays(today(), -6),
      actorUserId: alice,
      idempotencyKey: key(),
    });
    await expect(
      closeBooks(prisma, { day: today(), actorUserId: alice, actorRole: 'finance' }),
    ).rejects.toThrow('day_not_over');
    await closeBooks(prisma, { day: twoDaysAgo, actorUserId: alice, actorRole: 'finance' });
    expect(await booksLock(prisma)).toMatchObject({
      closedThrough: twoDaysAgo,
      updatedBy: 'Alice',
    });

    await expect(expense(10_000, alice, twoDaysAgo)).rejects.toThrow('books_closed');
    // Yesterday is still open.
    expect((await expense(10_000, alice, yesterday)).status).toBe('posted');

    // The database refuses it too, whatever the caller.
    const lock = await prisma.booksLock.findUniqueOrThrow({ where: { id: 'books' } });
    await expect(
      prisma.$transaction(async (tx) => {
        const entry = await tx.ledgerEntry.create({
          data: {
            number: 999,
            kind: 'test',
            idempotencyKey: key(),
            occurredAt: new Date(lock.lockedBefore.getTime() - 1),
          },
        });
        await tx.ledgerLine.create({
          data: {
            entryId: entry.id,
            accountId: (await byKey('bank')).id,
            amountPiastres: 1,
            occurredAt: entry.occurredAt,
          },
        });
      }),
    ).rejects.toThrow('books_closed');

    // Moving the date back reopens days: admin only, and only with a reason.
    const reopen = { day: addDays(today(), -5), actorUserId: alice };
    await expect(
      closeBooks(prisma, { ...reopen, actorRole: 'finance', reason: 'Late bill' }),
    ).rejects.toThrow('reopen_admin_only');
    await expect(closeBooks(prisma, { ...reopen, actorRole: 'admin' })).rejects.toThrow(
      'reason_required',
    );
    await closeBooks(prisma, { ...reopen, actorRole: 'admin', reason: 'Late rent bill' });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'finance.books_reopen' },
    });
    expect(audit.after).toMatchObject({ closedThrough: reopen.day, reason: 'Late rent bill' });
    expect((await expense(10_000, alice, twoDaysAgo)).status).toBe('posted');
  });

  it('never blocks automatic postings dated today', async () => {
    await closeBooks(prisma, {
      day: addDays(today(), -1),
      actorUserId: alice,
      actorRole: 'finance',
    });
    const entry = await post(prisma, {
      kind: 'order_fee',
      idempotencyKey: key(),
      lines: [
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: 500 },
        { account: { type: 'revenue' }, amount: -500 },
      ],
    });
    expect(entry).not.toBeNull();
  });
});

describe('a second person for large amounts', () => {
  it('posts small expenses at once and keeps large ones until another person approves', async () => {
    const cib = await byKey('bank');
    expect((await expense(999_999)).status).toBe('posted');
    const big = await expense(1_000_000);
    expect(big.status).toBe('pending');
    const before = await balanceOf(prisma, { id: cib.id });
    const requestId = big.status === 'pending' ? big.request.id : '';

    await expect(
      decideFinanceRequest(prisma, { requestId, approve: true, actorUserId: alice }),
    ).rejects.toThrow('same_person');
    await expect(
      decideFinanceRequest(prisma, { requestId, approve: false, actorUserId: bob }),
    ).rejects.toThrow('note_required');
    const done = await decideFinanceRequest(prisma, { requestId, approve: true, actorUserId: bob });
    expect(done.status).toBe('approved');
    expect(await balanceOf(prisma, { id: cib.id })).toBe(before - 1_000_000);
    // Posted in the name of whoever asked; deciding twice changes nothing.
    const entry = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: done.entryId! } });
    expect(entry.createdById).toBe(alice);
    await expect(
      decideFinanceRequest(prisma, { requestId, approve: true, actorUserId: bob }),
    ).rejects.toThrow('request_not_pending');
  });

  it('lets the asker cancel, and a rejection posts nothing', async () => {
    const drawings = await submitDrawings(prisma, {
      moneyAccountId: (await byKey('bank')).id,
      amountPiastres: 2_000_000,
      reference: 'Owner',
      actorUserId: alice,
      idempotencyKey: key(),
    });
    expect(drawings.status).toBe('pending');
    const id = drawings.status === 'pending' ? drawings.request.id : '';
    await expect(cancelFinanceRequest(prisma, { requestId: id, actorUserId: bob })).rejects.toThrow(
      'not_your_request',
    );
    await decideFinanceRequest(prisma, {
      requestId: id,
      approve: false,
      note: 'Not this month',
      actorUserId: bob,
    });
    expect(await prisma.ledgerEntry.count({ where: { kind: 'capital_out' } })).toBe(0);
  });

  it('needs another person to approve a large payout before it is paid', async () => {
    // The merchant is owed 12,000 EGP.
    await post(prisma, {
      kind: 'cod_collected',
      idempotencyKey: key(),
      lines: [
        { account: { type: 'store_cash', darkStoreId: f.store.id }, amount: 1_200_000 },
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: -1_200_000 },
      ],
    });
    const payout = await createPayout(prisma, {
      merchantId: f.merchant.id,
      cutoffAt: new Date(),
      actorUserId: alice,
    });
    const pay = () =>
      markPayoutPaid(prisma, { payoutId: payout.id, reference: 'TRX-1', actorUserId: alice });
    await expect(pay()).rejects.toThrow('approval_needed');
    await expect(
      approvePayout(prisma, { payoutId: payout.id, actorUserId: alice }),
    ).rejects.toThrow('same_person');
    await approvePayout(prisma, { payoutId: payout.id, actorUserId: bob });
    expect((await pay()).status).toBe('paid');
  });
});

describe('receipts', () => {
  it('lists money movements without a receipt until one is attached', async () => {
    const posted = await expense(50_000);
    const entryId = posted.status === 'posted' ? posted.entry.id : '';
    const before = await missingReceipts(prisma);
    expect(before.entries.map((e) => e.id)).toContain(entryId);
    const photo = await savePhoto(prisma, {
      kind: 'receipt',
      contentType: 'image/jpeg',
      data: JPEG,
      actorUserId: alice,
    });
    await attachReceipt(prisma, { entryId, photoId: photo.id, actorUserId: alice });
    expect((await missingReceipts(prisma)).entries.map((e) => e.id)).not.toContain(entryId);
    expect(await receiptsFor(prisma, { entryId })).toHaveLength(1);

    // A receipt sent with a request counts for the entry it becomes.
    const request = await submitExpense(prisma, {
      expenseAccountId: (await byKey('expense:rent')).id,
      paidFromAccountId: (await byKey('bank')).id,
      amountPiastres: 1_500_000,
      reference: 'INV-2',
      memo: 'Big rent',
      actorUserId: alice,
      idempotencyKey: key(),
      receiptPhotoId: photo.id,
    });
    const approved = await decideFinanceRequest(prisma, {
      requestId: request.status === 'pending' ? request.request.id : '',
      approve: true,
      actorUserId: bob,
    });
    expect(await receiptsFor(prisma, { entryId: approved.entryId! })).toHaveLength(1);
    expect((await missingReceipts(prisma)).entries.map((e) => e.id)).not.toContain(
      approved.entryId,
    );
  });
});

describe('opening balances', () => {
  it('posts every starting balance once, against Opening balances', async () => {
    await resetDatabase();
    f = await createFixture();
    alice = (
      await prisma.user.create({
        data: { email: 'a@t.eg', name: 'A', role: 'admin', passwordHash: 'x' },
      })
    ).id;
    await ensureDefaultAccounts(prisma);
    const cib = await byKey('bank');
    const vat = await prisma.ledgerAccount.create({
      data: {
        key: 'vat_payable',
        type: 'vat_payable',
        code: '2301',
        groupCode: 2300,
        category: 'liability',
        nameEn: 'VAT',
        nameAr: 'VAT',
      },
    });
    const day = addDays(today(), -3);
    await recordOpeningBalances(prisma, {
      day,
      lines: [
        { accountId: cib.id, amountPiastres: 800_000 },
        // We owe 300 EGP of VAT: positive on its normal (credit) side.
        { accountId: vat.id, amountPiastres: 30_000 },
      ],
      actorUserId: alice,
    });
    expect(await balanceOf(prisma, { id: cib.id })).toBe(800_000);
    expect(await balanceOf(prisma, { id: vat.id })).toBe(-30_000);
    expect(await balanceOf(prisma, { id: (await byKey('equity:opening')).id })).toBe(-770_000);
    await expect(
      recordOpeningBalances(prisma, {
        day,
        lines: [{ accountId: cib.id, amountPiastres: 1 }],
        actorUserId: alice,
      }),
    ).rejects.toThrow('opening_already_posted');
  });
});

describe('money cannot be created on paper', () => {
  // Rent and electricity paid together from the bank: two debits, one credit.
  const rentAndPower = async (total: number, cib: string) => {
    const power = Math.round(total / 5);
    return [
      {
        accountId: (await byKey('expense:rent')).id,
        debitPiastres: total - power,
        creditPiastres: 0,
      },
      { accountId: (await byKey('expense:utilities')).id, debitPiastres: power, creditPiastres: 0 },
      { accountId: cib, debitPiastres: 0, creditPiastres: total },
    ];
  };

  it('posts a compound journal entry paid from the bank at once below the limit', async () => {
    const cib = await byKey('bank');
    const before = await balanceOf(prisma, { id: cib.id });
    // 9,999 EGP: below the 10,000 EGP limit.
    const result = await submitJournalEntry(prisma, {
      lines: await rentAndPower(999_900, cib.id),
      reason: 'Rent and electricity, one transfer',
      actorUserId: alice,
      idempotencyKey: key(),
    });
    expect(result.status).toBe('posted');
    expect(await balanceOf(prisma, { id: cib.id })).toBe(before - 999_900);
    const lines = await prisma.ledgerLine.findMany({
      where: { entryId: result.status === 'posted' ? result.entry.id : '' },
    });
    expect(lines).toHaveLength(3);
  });

  it('keeps money going out from the limit and any money coming in for a second person', async () => {
    const cib = await byKey('bank');
    const before = await balanceOf(prisma, { id: cib.id });
    const out = await submitJournalEntry(prisma, {
      lines: await rentAndPower(1_000_000, cib.id),
      reason: 'Rent and electricity, one transfer',
      actorUserId: alice,
      idempotencyKey: key(),
    });
    expect(out.status).toBe('pending');
    expect(await balanceOf(prisma, { id: cib.id })).toBe(before);
    const requestId = out.status === 'pending' ? out.request.id : '';
    await expect(
      decideFinanceRequest(prisma, { requestId, approve: true, actorUserId: alice }),
    ).rejects.toThrow('same_person');
    await decideFinanceRequest(prisma, { requestId, approve: true, actorUserId: bob });
    expect(await balanceOf(prisma, { id: cib.id })).toBe(before - 1_000_000);

    // Money said to come in waits whatever the amount.
    const found = await submitJournalEntry(prisma, {
      lines: [
        { accountId: cib.id, debitPiastres: 100, creditPiastres: 0 },
        {
          accountId: (await byKey('other_income:general')).id,
          debitPiastres: 0,
          creditPiastres: 100,
        },
      ],
      reason: 'Found money',
      actorUserId: alice,
      idempotencyKey: key(),
    });
    expect(found.status).toBe('pending');
    expect(await balanceOf(prisma, { id: cib.id })).toBe(before - 1_000_000);
  });

  it('never takes more than a bank holds, and keeps banks out of accruals', async () => {
    const cib = await byKey('bank');
    const held = await balanceOf(prisma, { id: cib.id });
    await expect(
      recordJournalEntry(prisma, {
        lines: await rentAndPower(held + 100, cib.id),
        reason: 'Too much',
        actorUserId: alice,
        idempotencyKey: key(),
      }),
    ).rejects.toThrow('not_enough_money');
    await expect(
      recordJournalEntry(prisma, {
        lines: await rentAndPower(1_000, cib.id),
        reason: 'Accrued rent',
        reverseNextMonth: true,
        actorUserId: alice,
        idempotencyKey: key(),
      }),
    ).rejects.toThrow('accrual_money_not_allowed');
  });

  it('keeps every claimed money in and merchant balance change for a second person, at any amount', async () => {
    const cib = await byKey('bank');
    const before = await balanceOf(prisma, { id: cib.id });
    const capital = await submitCapitalIn(prisma, {
      moneyAccountId: cib.id,
      amountPiastres: 100,
      reference: 'Owner',
      actorUserId: alice,
      idempotencyKey: key(),
    });
    expect(capital.status).toBe('pending');
    const raise = await submitMerchantAdjustment(prisma, {
      merchantId: f.merchant.id,
      amountPiastres: 100,
      reason: 'Goodwill credit',
      actorUserId: alice,
      idempotencyKey: key(),
    });
    expect(raise.status).toBe('pending');
    expect(await balanceOf(prisma, { id: cib.id })).toBe(before);
    expect(await balanceOf(prisma, { type: 'merchant', merchantId: f.merchant.id })).toBe(0);
    await decideFinanceRequest(prisma, {
      requestId: capital.status === 'pending' ? capital.request.id : '',
      approve: true,
      actorUserId: bob,
    });
    expect(await balanceOf(prisma, { id: cib.id })).toBe(before + 100);
  });
});
