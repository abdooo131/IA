import { addDays, cairoDay } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { setSetting } from '../src/settings';
import {
  accountingDocument,
  addPayoutProof,
  balanceOf,
  closeBooks,
  createPayout,
  decideFinanceRequest,
  ensureDefaultAccounts,
  post,
  recordCapital,
  recordJournalEntry,
  reverseAccruals,
  submitExpense,
  submitLoan,
  submitLoanPayment,
  payrollRunStatus,
} from '../src/finance';
import { createFixture, prisma, resetDatabase, slipPdf } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let asker: string;
let approver: string;
let n = 0;
const key = () => `fixc-${++n}-${Math.random()}`;
const byKey = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });
const today = () => cairoDay(new Date());

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  asker = (
    await prisma.user.create({
      data: { email: 'asker@t.eg', name: 'Asker', role: 'finance', passwordHash: 'x' },
    })
  ).id;
  approver = (
    await prisma.user.create({
      data: { email: 'approver@t.eg', name: 'Approver', role: 'finance', passwordHash: 'x' },
    })
  ).id;
  await ensureDefaultAccounts(prisma);
  await recordCapital(prisma, {
    direction: 'in',
    moneyAccountId: (await byKey('bank')).id,
    amountPiastres: 50_000_000,
    reference: 'Owner',
    day: addDays(today(), -1),
    actorUserId: asker,
    idempotencyKey: key(),
  });
  await setSetting(prisma, {
    key: 'finance.approval_threshold_piastres',
    value: 1_000_000,
    actorUserId: asker,
  });
});

afterAll(() => prisma.$disconnect());

/** A 20,000 EGP expense from the bank: above the limit, so it waits for a second person. */
async function bigExpense() {
  const result = await submitExpense(prisma, {
    expenseAccountId: (await byKey('expense:rent')).id,
    paidFromAccountId: (await byKey('bank')).id,
    amountPiastres: 2_000_000,
    reference: 'Rent November',
    darkStoreId: f.store.id,
    actorUserId: asker,
    idempotencyKey: key(),
  });
  expect(result.status).toBe('pending');
  return (result as { request: { id: string } }).request.id;
}

describe('approval request page', () => {
  it('shows the lines approval would post, without posting them, under its own number', async () => {
    const requestId = await bigExpense();
    const entriesBefore = await prisma.ledgerEntry.count();
    const doc = (await accountingDocument(prisma, 'finance_request', requestId))!;
    expect(doc.number).toMatch(/^REQ-[A-Z0-9]{6}$/);
    expect(doc.data.linesPreview).toBe(true);
    expect(doc.data.previewError).toBeNull();
    const rows = doc.lines!.rows;
    expect(rows).toHaveLength(2);
    const debit = rows.find((r) => r.debit)!;
    const credit = rows.find((r) => r.credit)!;
    expect(debit).toMatchObject({ debit: 2_000_000, store: f.store.code });
    expect(String(debit.account)).toMatch(/^5/);
    expect(credit).toMatchObject({ credit: 2_000_000 });
    expect(String(credit.account)).toMatch(/^110/);
    // Nothing was posted or numbered by the preview.
    expect(await prisma.ledgerEntry.count()).toBe(entriesBefore);
    expect(
      (await prisma.financeRequest.findUniqueOrThrow({ where: { id: requestId } })).status,
    ).toBe('pending');

    // After approval the page keeps the request's number and shows the posted lines.
    await decideFinanceRequest(prisma, { requestId, approve: true, actorUserId: approver });
    const after = (await accountingDocument(prisma, 'finance_request', requestId))!;
    expect(after.number).toBe(doc.number);
    expect(after.data.linesPreview).toBe(false);
    expect(after.lines!.rows).toHaveLength(2);
    expect(after.smart.find((s) => s.key === 'entry')?.value).toMatch(/^JV-/);
  });

  it('answers the refusal approval would meet instead of lines', async () => {
    const requestId = await bigExpense();
    // The bank is emptied meanwhile: approval would be refused.
    const bank = await byKey('bank');
    const held = await balanceOf(prisma, { id: bank.id });
    await recordJournalEntry(prisma, {
      lines: [
        { accountId: (await byKey('equity:capital')).id, debitPiastres: held, creditPiastres: 0 },
        { accountId: bank.id, debitPiastres: 0, creditPiastres: held },
      ],
      reason: 'Owner takes it back',
      actorUserId: asker,
      idempotencyKey: key(),
    });
    const doc = (await accountingDocument(prisma, 'finance_request', requestId))!;
    expect(doc.data.previewError).toBe('not_enough_money');
    expect(doc.lines).toBeNull();
  });
});

describe('entries posted through an approval', () => {
  it('name the request as Posted for, were prepared when asked, and credit the approver in history', async () => {
    const requestId = await bigExpense();
    const request = await prisma.financeRequest.findUniqueOrThrow({ where: { id: requestId } });
    await new Promise((r) => setTimeout(r, 30));
    const { entryId } = await decideFinanceRequest(prisma, {
      requestId,
      approve: true,
      actorUserId: approver,
    });
    const doc = (await accountingDocument(prisma, 'ledger_entry', entryId!))!;
    const source = doc.fields.find((x) => x.key === 'source')!;
    expect(source.value).toMatch(/^REQ-/);
    expect(source.href).toBe(`/finance/approvals/${requestId}`);
    // The request is the source: no second tile for it.
    expect(doc.smart.filter((s) => s.href === `/finance/approvals/${requestId}`)).toHaveLength(1);
    expect(doc.fields.find((x) => x.key === 'createdAt')?.value).toBe(
      request.createdAt.toISOString(),
    );
    expect(doc.fields.find((x) => x.key === 'createdBy')?.value).toBe('Asker');
    expect(doc.fields.find((x) => x.key === 'approvedBy')?.value).toBe('Approver');
    // Audit rows written by the posting name the approver, keeping who asked.
    const rows = await prisma.auditLog.findMany({
      where: {
        createdAt: { gt: request.createdAt },
        action: { notIn: ['finance.request_create', 'finance.request_approve'] },
      },
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.actorUserId).toBe(approver);
      expect(row.after).toMatchObject({ requestedBy: asker, requestId });
    }
  });

  it('a cheque booked on approval is booked by the approver in its history', async () => {
    const { registerCheque } = await import('../src/finance');
    const result = await registerCheque(prisma, {
      direction: 'received',
      purpose: 'merchant',
      merchantId: f.merchant.id,
      chequeNumber: '77',
      bankName: 'NBE',
      amountPiastres: 50_000,
      issueDate: today(),
      dueDate: today(),
      idempotencyKey: key(),
      actorUserId: asker,
    });
    expect(result.status).toBe('pending');
    await decideFinanceRequest(prisma, {
      requestId: result.request!.id,
      approve: true,
      actorUserId: approver,
    });
    const book = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'finance.cheque_book', entityId: result.cheque.id },
    });
    expect(book.actorUserId).toBe(approver);
    const register = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'finance.cheque_register', entityId: result.cheque.id },
    });
    expect(register.actorUserId).toBe(asker);
  });
});

describe('accrual reversals', () => {
  it('link to the accrual they turn round, and the accrual to its reversal', async () => {
    const accrual = await recordJournalEntry(prisma, {
      lines: [
        {
          accountId: (await byKey('expense:utilities')).id,
          debitPiastres: 30_000,
          creditPiastres: 0,
        },
        { accountId: (await byKey('equity:capital')).id, debitPiastres: 0, creditPiastres: 30_000 },
      ],
      reason: 'Electricity used, bill not here yet',
      day: addDays(today(), -1),
      reverseNextMonth: true,
      actorUserId: asker,
      idempotencyKey: key(),
    });
    await reverseAccruals(prisma, new Date(Date.now() + 40 * 86_400_000));
    const reversal = await prisma.ledgerEntry.findUniqueOrThrow({
      where: { idempotencyKey: `accrual_reversal:${accrual.id}` },
    });
    const doc = (await accountingDocument(prisma, 'ledger_entry', reversal.id))!;
    const source = doc.fields.find((x) => x.key === 'source')!;
    expect(source.href).toBe(`/finance/journal/${accrual.id}`);
    expect(source.value).toMatch(/^JV-/);
    const accrualDoc = (await accountingDocument(prisma, 'ledger_entry', accrual.id))!;
    expect(accrualDoc.smart.find((s) => s.key === 'reversal')?.href).toBe(
      `/finance/journal/${reversal.id}`,
    );
  });
});

describe('payout proof of transfer', () => {
  it('counts as a receipt on the payout page', async () => {
    await post(prisma, {
      kind: 'cod_collected',
      idempotencyKey: key(),
      occurredAt: new Date(Date.now() - 2 * 86_400_000),
      lines: [
        { account: { type: 'bank' }, amount: 80_000 },
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: -80_000 },
      ],
    });
    const payout = await createPayout(prisma, {
      merchantId: f.merchant.id,
      cutoffAt: new Date(),
      actorUserId: asker,
    });
    let doc = (await accountingDocument(prisma, 'payout', payout.id))!;
    expect(doc.smart.find((s) => s.key === 'receipts')?.count).toBe(0);
    await addPayoutProof(prisma, {
      payoutId: payout.id,
      fileName: 'slip.pdf',
      contentType: 'application/pdf',
      data: slipPdf(),
      amountPiastres: 80_000,
      reference: 'TRF-9',
      actorUserId: asker,
    });
    doc = (await accountingDocument(prisma, 'payout', payout.id))!;
    expect(doc.smart.find((s) => s.key === 'receipts')?.count).toBe(1);
    expect(doc.attachments[0]).toMatchObject({
      href: `/api/finance/payouts/${payout.id}/proof`,
      contentType: 'application/pdf',
    });
  });
});

describe('loans', () => {
  const loanInput = async (startDay: string) => ({
    lender: 'bank' as const,
    lenderName: 'National Bank of Egypt',
    principalPiastres: 1_200_000,
    moneyAccountId: (await byKey('bank')).id,
    startDay,
    annualRateBp: 1_200,
    months: 12,
    firstPaymentDay: addDays(today(), 20),
    reference: 'NBE-77',
    actorUserId: asker,
    idempotencyKey: key(),
  });

  it('refuses a loan dated inside closed books when it is sent, not only at approval', async () => {
    await closeBooks(prisma, {
      day: addDays(today(), -5),
      actorUserId: asker,
      actorRole: 'admin',
    });
    await expect(submitLoan(prisma, await loanInput(addDays(today(), -10)))).rejects.toThrow(
      'books_closed',
    );
    expect(await prisma.financeRequest.count({ where: { kind: 'loan_in' } })).toBe(0);
    // The first open day is accepted.
    const sent = await submitLoan(prisma, await loanInput(addDays(today(), -4)));
    expect(['pending', 'posted']).toContain(sent.status);
  });

  it('never pays an instalment from Money at Basata', async () => {
    await setSetting(prisma, { key: 'finance.approve_money_in', value: 0, actorUserId: asker });
    const sent = await submitLoan(prisma, await loanInput(today()));
    expect(sent.status).toBe('posted');
    const loan = await prisma.loan.findFirstOrThrow();
    // Money at Basata holds cash on its way to the bank.
    await post(prisma, {
      kind: 'test_transit',
      idempotencyKey: key(),
      lines: [
        { account: { type: 'basata_transit' }, amount: 5_000_000 },
        { account: { type: 'bank' }, amount: -5_000_000 },
      ],
    });
    const transit = await byKey('basata_transit');
    await expect(
      submitLoanPayment(prisma, {
        loanId: loan.id,
        moneyAccountId: transit.id,
        reference: 'From Basata',
        actorUserId: asker,
        idempotencyKey: key(),
      }),
    ).rejects.toThrow('money_account_not_allowed');
  });
});

describe('salary run status', () => {
  it('shows a month as open, waiting for a second person, then paid with its entry', async () => {
    expect(await payrollRunStatus(prisma, '2026-09')).toMatchObject({
      status: 'open',
      entryId: null,
    });
    const request = await prisma.financeRequest.create({
      data: {
        kind: 'payroll',
        amountPiastres: 100_000,
        payload: { kind: 'payroll', input: { month: '2026-09', idempotencyKey: 'x' } },
        requestedById: asker,
      },
    });
    expect(await payrollRunStatus(prisma, '2026-09')).toMatchObject({
      status: 'pending',
      requestId: request.id,
    });
    const entry = await post(prisma, {
      kind: 'payroll',
      idempotencyKey: 'payroll:2026-09',
      lines: [
        { account: { id: (await byKey('expense:salaries')).id }, amount: 100_000 },
        { account: { type: 'bank' }, amount: -100_000 },
      ],
    });
    expect(await payrollRunStatus(prisma, '2026-09')).toMatchObject({
      status: 'paid',
      entryId: entry!.id,
      entryNumber: entry!.number,
      requestId: null,
    });
    await expect(payrollRunStatus(prisma, '2026-13')).rejects.toThrow('invalid_month');
  });
});
