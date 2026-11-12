import { addDays, cairoDay } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { changeSetting } from '../src/admin-ops';
import {
  addPayoutProof,
  balanceOf,
  bounceCheque,
  cancelCheque,
  chequesDue,
  clearCheque,
  createPayout,
  createSupplier,
  decideFinanceRequest,
  depositCheque,
  ensureDefaultAccounts,
  getCheque,
  listPayoutChecks,
  markPayoutCheck,
  markPayoutPaid,
  merchantOwed,
  payoutControls,
  post,
  recordBill,
  recordCapital,
  registerCheque,
} from '../src/finance';
import { createFixture, prisma, resetDatabase, slipPdf } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let second: string;
let n = 0;
const key = () => `chq-${++n}-${Math.random()}`;
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
  second = (
    await prisma.user.create({
      data: { email: 'b@t.eg', name: 'Second', role: 'finance', passwordHash: 'x' },
    })
  ).id;
  await ensureDefaultAccounts(prisma);
  await recordCapital(prisma, {
    direction: 'in',
    moneyAccountId: (await byKey('bank')).id,
    amountPiastres: 10_000_000,
    reference: 'Owner',
    actorUserId: admin,
    idempotencyKey: key(),
  });
});

afterAll(() => prisma.$disconnect());

/** Every active payout check ticked on a payout by one person. */
async function tickAll(payoutId: string, by: string) {
  for (const check of await listPayoutChecks(prisma, { activeOnly: true }))
    await markPayoutCheck(prisma, { payoutId, checkId: check.id, actorUserId: by });
}

/** The merchant owes us 500 EGP of fees. */
async function merchantOwes(amount: number) {
  await post(prisma, {
    kind: 'order_fee',
    idempotencyKey: key(),
    lines: [
      { account: { type: 'merchant', merchantId: f.merchant.id }, amount },
      { account: { type: 'revenue' }, amount: -amount },
    ],
  });
}

async function linesBalance() {
  const sum = await prisma.ledgerLine.aggregate({ _sum: { amountPiastres: true } });
  return sum._sum.amountPiastres ?? 0;
}

describe('cheques received', () => {
  it('waits for a second person, sits under collection, then clears into the bank on its due day', async () => {
    await merchantOwes(50_000);
    const due = addDays(today(), 3);
    const result = await registerCheque(prisma, {
      direction: 'received',
      purpose: 'merchant',
      chequeNumber: '100200',
      bankName: 'NBE',
      amountPiastres: 50_000,
      issueDate: today(),
      dueDate: due,
      merchantId: f.merchant.id,
      idempotencyKey: key(),
      actorUserId: admin,
    });
    // A cheque given to us is claimed money in: a second person approves it first.
    expect(result.status).toBe('pending');
    expect(result.cheque.status).toBe('awaiting_approval');
    expect(result.cheque.partyName).toBe('Merchant');
    await expect(
      decideFinanceRequest(prisma, {
        requestId: result.request!.id,
        approve: true,
        actorUserId: admin,
      }),
    ).rejects.toThrow('same_person');
    await decideFinanceRequest(prisma, {
      requestId: result.request!.id,
      approve: true,
      actorUserId: second,
    });
    const cheque = await prisma.cheque.findUniqueOrThrow({ where: { id: result.cheque.id } });
    expect(cheque.status).toBe('received');
    const underCollection = await byKey('cheques_under_collection');
    expect(underCollection.code).toBe('1151');
    expect(await balanceOf(prisma, { type: 'cheques_under_collection' })).toBe(50_000);
    expect(await merchantOwed(prisma, f.merchant.id)).toBe(0);

    // The same cheque cannot be registered twice.
    await expect(
      registerCheque(prisma, {
        direction: 'received',
        purpose: 'merchant',
        chequeNumber: '100200',
        bankName: 'nbe',
        amountPiastres: 50_000,
        issueDate: today(),
        dueDate: due,
        merchantId: f.merchant.id,
        idempotencyKey: key(),
        actorUserId: admin,
      }),
    ).rejects.toThrow('cheque_exists');

    const list = await chequesDue(prisma, today());
    expect(list.thisWeek.map((c) => c.id)).toEqual([cheque.id]);
    expect((await chequesDue(prisma, addDays(today(), 10))).overdue).toHaveLength(1);

    await depositCheque(prisma, { chequeId: cheque.id, actorUserId: admin });
    // Post dated: the bank pays it on its due day, not before.
    await expect(clearCheque(prisma, { chequeId: cheque.id, actorUserId: admin })).rejects.toThrow(
      'cheque_not_due',
    );
    await prisma.cheque.update({
      where: { id: cheque.id },
      data: { dueDate: new Date(`${today()}T00:00:00Z`) },
    });
    const bankBefore = await balanceOf(prisma, { type: 'bank' });
    await clearCheque(prisma, { chequeId: cheque.id, actorUserId: admin });
    expect(await balanceOf(prisma, { type: 'bank' })).toBe(bankBefore + 50_000);
    expect(await balanceOf(prisma, { type: 'cheques_under_collection' })).toBe(0);
    const detail = await getCheque(prisma, cheque.id);
    expect(detail.status).toBe('cleared');
    expect(detail.clearEntry).not.toBeNull();
    expect(await linesBalance()).toBe(0);
  });

  it('a bounced cheque puts the debt back and raises an alert; a rejected one is cancelled', async () => {
    await changeSetting(prisma, {
      key: 'finance.approve_money_in',
      scope: 'global',
      value: 0,
      actorUserId: admin,
    });
    await merchantOwes(30_000);
    const result = await registerCheque(prisma, {
      direction: 'received',
      purpose: 'merchant',
      chequeNumber: '777',
      bankName: 'Banque Misr',
      amountPiastres: 30_000,
      issueDate: today(),
      dueDate: today(),
      merchantId: f.merchant.id,
      idempotencyKey: key(),
      actorUserId: admin,
    });
    expect(result.status).toBe('posted');
    expect(await merchantOwed(prisma, f.merchant.id)).toBe(0);
    await bounceCheque(prisma, {
      chequeId: result.cheque.id,
      reason: 'Insufficient funds',
      actorUserId: admin,
    });
    expect(await merchantOwed(prisma, f.merchant.id)).toBe(-30_000);
    expect(await balanceOf(prisma, { type: 'cheques_under_collection' })).toBe(0);
    const alert = await prisma.alert.findFirstOrThrow({ where: { type: 'cheque_bounced' } });
    expect(alert.merchantId).toBe(f.merchant.id);
    expect(alert.data).toMatchObject({ chequeNumber: '777', reason: 'Insufficient funds' });
    // A bounced cheque can be written again with the same number.
    await changeSetting(prisma, {
      key: 'finance.approve_money_in',
      scope: 'global',
      value: 1,
      actorUserId: admin,
    });
    const again = await registerCheque(prisma, {
      direction: 'received',
      purpose: 'merchant',
      chequeNumber: '777',
      bankName: 'Banque Misr',
      amountPiastres: 30_000,
      issueDate: today(),
      dueDate: today(),
      merchantId: f.merchant.id,
      idempotencyKey: key(),
      actorUserId: admin,
    });
    await decideFinanceRequest(prisma, {
      requestId: again.request!.id,
      approve: false,
      note: 'No such cheque',
      actorUserId: second,
    });
    const dropped = await prisma.cheque.findUniqueOrThrow({ where: { id: again.cheque.id } });
    expect(dropped.status).toBe('cancelled');
    expect(await linesBalance()).toBe(0);
  });
});

describe('cheques issued', () => {
  it('pays a bill through cheques payable, clears from the bank, and a bounce reopens the bill', async () => {
    const supplier = await createSupplier(prisma, {
      name: 'Landlord',
      whtBp: 100,
      actorUserId: admin,
    });
    const bill = await recordBill(prisma, {
      supplierId: supplier.id,
      reference: 'R-1',
      billDate: today(),
      dueDate: today(),
      expenseAccountId: (await byKey('expense:rent')).id,
      netPiastres: 1_000_000,
      vatPiastres: 140_000,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    const cib = await byKey('bank');
    // Under the approval limit (10,000 EGP default) it is booked at once.
    const half = await registerCheque(prisma, {
      direction: 'issued',
      purpose: 'bill',
      chequeNumber: '5001',
      bankAccountId: cib.id,
      amountPiastres: 570_000,
      issueDate: today(),
      dueDate: addDays(today(), 30),
      billId: bill.id,
      idempotencyKey: key(),
      actorUserId: admin,
    });
    expect(half.status).toBe('posted');
    // 1% of the 5,000 EGP before VAT is kept back: the cheque is for 5,650.
    expect(half.cheque.amountPiastres).toBe(565_000);
    expect(half.cheque.partyName).toBe('Landlord');
    expect(await balanceOf(prisma, { type: 'cheques_payable' })).toBe(-565_000);
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } })).paidPiastres).toBe(
      570_000,
    );
    const bankBefore = await balanceOf(prisma, { type: 'bank' });
    await clearCheque(prisma, { chequeId: half.cheque.id, actorUserId: admin });
    expect(await balanceOf(prisma, { type: 'bank' })).toBe(bankBefore - 565_000);
    expect(await balanceOf(prisma, { type: 'cheques_payable' })).toBe(0);

    const rest = await registerCheque(prisma, {
      direction: 'issued',
      purpose: 'bill',
      chequeNumber: '5002',
      bankAccountId: cib.id,
      amountPiastres: 570_000,
      issueDate: today(),
      dueDate: today(),
      billId: bill.id,
      idempotencyKey: key(),
      actorUserId: admin,
    });
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe('paid');
    const supplierOwed = await balanceOf(prisma, { type: 'supplier', supplierId: supplier.id });
    expect(supplierOwed).toBe(0);
    await bounceCheque(prisma, {
      chequeId: rest.cheque.id,
      reason: 'Signature',
      actorUserId: admin,
    });
    const reopened = await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } });
    expect(reopened).toMatchObject({ status: 'open', paidPiastres: 570_000 });
    expect(await balanceOf(prisma, { type: 'supplier', supplierId: supplier.id })).toBe(-570_000);
    expect(await balanceOf(prisma, { type: 'cheques_payable' })).toBe(0);
    expect(await linesBalance()).toBe(0);
  });

  it('pays a payout by cheque; cancelling the cheque cancels the payout and the merchant is owed again', async () => {
    await post(prisma, {
      kind: 'cod_collected',
      idempotencyKey: key(),
      occurredAt: new Date(Date.now() - 86_400_000 * 2),
      lines: [
        { account: { type: 'bank' }, amount: 80_000 },
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: -80_000 },
      ],
    });
    const payout = await createPayout(prisma, {
      merchantId: f.merchant.id,
      cutoffAt: new Date(),
      actorUserId: admin,
    });
    const cib = await byKey('bank');
    const result = await registerCheque(prisma, {
      direction: 'issued',
      purpose: 'payout',
      chequeNumber: '9',
      bankAccountId: cib.id,
      issueDate: today(),
      dueDate: today(),
      payoutId: payout.id,
      idempotencyKey: key(),
      actorUserId: admin,
    });
    // The cheque is the payout's proof; it is booked once the payout checks are ticked.
    expect(result.status).toBe('awaiting_checks');
    expect(result.cheque.amountPiastres).toBe(80_000);
    await tickAll(payout.id, second);
    await markPayoutPaid(prisma, { payoutId: payout.id, actorUserId: admin });
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe(
      'paid',
    );
    expect(await merchantOwed(prisma, f.merchant.id)).toBe(0);
    await cancelCheque(prisma, {
      chequeId: result.cheque.id,
      note: 'Wrong amount',
      actorUserId: admin,
    });
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe(
      'cancelled',
    );
    expect(await merchantOwed(prisma, f.merchant.id)).toBe(80_000);
    expect(await balanceOf(prisma, { type: 'cheques_payable' })).toBe(0);
    // A cleared cheque cannot be cancelled.
    await expect(
      cancelCheque(prisma, { chequeId: result.cheque.id, note: 'again', actorUserId: admin }),
    ).rejects.toThrow('cheque_not_cancellable');
  });

  it('a payout cheque waits for the payout checks, second person included, then queues the emails', async () => {
    await prisma.merchant.update({
      where: { id: f.merchant.id },
      data: { contactEmail: 'owner@merchant.eg' },
    });
    await post(prisma, {
      kind: 'cod_collected',
      idempotencyKey: key(),
      occurredAt: new Date(Date.now() - 86_400_000 * 2),
      lines: [
        { account: { type: 'bank' }, amount: 80_000 },
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: -80_000 },
      ],
    });
    const payout = await createPayout(prisma, {
      merchantId: f.merchant.id,
      cutoffAt: new Date(),
      actorUserId: admin,
    });
    const result = await registerCheque(prisma, {
      direction: 'issued',
      purpose: 'payout',
      chequeNumber: '11',
      bankAccountId: (await byKey('bank')).id,
      issueDate: today(),
      dueDate: today(),
      payoutId: payout.id,
      idempotencyKey: key(),
      actorUserId: admin,
    });
    expect(result.status).toBe('awaiting_checks');
    expect(result.cheque.status).toBe('awaiting_approval');
    // Nothing is paid or booked yet.
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe(
      'draft',
    );
    expect(await merchantOwed(prisma, f.merchant.id)).toBe(80_000);
    expect(await balanceOf(prisma, { type: 'cheques_payable' })).toBe(0);
    // The cheque is the proof: no slip is asked for, and none can be added.
    const controls = await payoutControls(prisma, payout.id, admin);
    expect(controls.cheque).toMatchObject({ status: 'awaiting_approval' });
    expect(controls.blockers).toEqual(['checks_incomplete']);
    await expect(
      addPayoutProof(prisma, {
        payoutId: payout.id,
        fileName: 'slip.pdf',
        contentType: 'application/pdf',
        data: slipPdf(),
        amountPiastres: 80_000,
        reference: 'TRF-1',
        actorUserId: admin,
      }),
    ).rejects.toThrow('payout_has_cheque');
    // A second cheque for the same payout is refused.
    await expect(
      registerCheque(prisma, {
        direction: 'issued',
        purpose: 'payout',
        chequeNumber: '12',
        bankAccountId: (await byKey('bank')).id,
        issueDate: today(),
        dueDate: today(),
        payoutId: payout.id,
        idempotencyKey: key(),
        actorUserId: admin,
      }),
    ).rejects.toThrow('payout_has_cheque');
    // Without the checks it cannot be paid.
    await expect(
      markPayoutPaid(prisma, { payoutId: payout.id, actorUserId: admin }),
    ).rejects.toThrow('checks_incomplete');
    // The payer cannot be the second person.
    await tickAll(payout.id, admin);
    await expect(
      markPayoutPaid(prisma, { payoutId: payout.id, actorUserId: admin }),
    ).rejects.toThrow('same_person');
    await markPayoutPaid(prisma, { payoutId: payout.id, actorUserId: second });
    const paid = await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
    expect(paid).toMatchObject({ status: 'paid', paidById: second });
    expect(paid.reference).toContain('CHQ-');
    expect(
      (await prisma.cheque.findUniqueOrThrow({ where: { id: result.cheque.id } })).status,
    ).toBe('issued');
    expect(await merchantOwed(prisma, f.merchant.id)).toBe(0);
    expect(await balanceOf(prisma, { type: 'cheques_payable' })).toBe(-80_000);
    // The same payout paid email as a transfer: the statement attached, no proof file.
    const emails = await prisma.emailOutbox.findMany({ where: { merchantId: f.merchant.id } });
    const notice = emails.find((e) => e.kind === 'payout_paid');
    expect(notice).toBeDefined();
    const refs = JSON.stringify(notice);
    expect(refs).toContain('payout_soa_pdf');
    expect(refs).not.toContain('payout_proof:');
    expect(emails.some((e) => e.kind === 'statement')).toBe(true);
    // Clearing still takes the money out of the bank.
    await clearCheque(prisma, { chequeId: result.cheque.id, actorUserId: second });
    expect(await balanceOf(prisma, { type: 'cheques_payable' })).toBe(0);
  });

  it('refuses a payout cheque for more than the merchant is owed now', async () => {
    await post(prisma, {
      kind: 'cod_collected',
      idempotencyKey: key(),
      occurredAt: new Date(Date.now() - 86_400_000 * 2),
      lines: [
        { account: { type: 'bank' }, amount: 80_000 },
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: -80_000 },
      ],
    });
    const payout = await createPayout(prisma, {
      merchantId: f.merchant.id,
      cutoffAt: new Date(),
      actorUserId: admin,
    });
    // Fees booked after the draft: the merchant is owed 75,000 now.
    await merchantOwes(5_000);
    await expect(
      registerCheque(prisma, {
        direction: 'issued',
        purpose: 'payout',
        chequeNumber: '10',
        bankAccountId: (await byKey('bank')).id,
        issueDate: today(),
        dueDate: today(),
        payoutId: payout.id,
        idempotencyKey: key(),
        actorUserId: admin,
      }),
    ).rejects.toMatchObject({ code: 'payout_more_than_owed' });
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: payout.id } })).status).toBe(
      'draft',
    );
    expect(await prisma.cheque.count()).toBe(0);
    expect(await merchantOwed(prisma, f.merchant.id)).toBe(75_000);
  });

  it('waits for a second person from the approval limit', async () => {
    const supplier = await createSupplier(prisma, { name: 'Builder', actorUserId: admin });
    const bill = await recordBill(prisma, {
      supplierId: supplier.id,
      reference: 'B-1',
      billDate: today(),
      dueDate: today(),
      expenseAccountId: (await byKey('expense:maintenance')).id,
      netPiastres: 2_000_000,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    const result = await registerCheque(prisma, {
      direction: 'issued',
      purpose: 'bill',
      chequeNumber: '6001',
      bankAccountId: (await byKey('bank')).id,
      amountPiastres: 2_000_000,
      issueDate: today(),
      dueDate: today(),
      billId: bill.id,
      idempotencyKey: key(),
      actorUserId: admin,
    });
    expect(result.status).toBe('pending');
    await decideFinanceRequest(prisma, {
      requestId: result.request!.id,
      approve: true,
      actorUserId: second,
    });
    expect(
      (await prisma.cheque.findUniqueOrThrow({ where: { id: result.cheque.id } })).status,
    ).toBe('issued');
    expect(await balanceOf(prisma, { type: 'cheques_payable' })).toBe(-2_000_000);
  });
});
