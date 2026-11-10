import { addDays, cairoDay, cairoDayStart } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMonths,
  balanceOf,
  cancelBill,
  createSignerKey,
  createSupplier,
  decideFinanceRequest,
  documentsToSign,
  ensureDefaultAccounts,
  getInvoice,
  issueCreditNote,
  listInvoices,
  payablesAging,
  payBill,
  post,
  prepareInvoices,
  receivablesAging,
  recordBill,
  recordEtaResult,
  runReceivableReminders,
  sendReminderNow,
  submitDebitNote,
  updateCompanyProfile,
  vatReport,
  vatReturn,
} from '../src/finance';
import { setSetting } from '../src/settings';
import { createFixture, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let second: string;
let n = 0;
const key = () => `aging-${++n}-${Math.random()}`;
const byKey = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });
/** Noon in Cairo on a calendar day. */
const noon = (day: string) => new Date(cairoDayStart(day).getTime() + 12 * 3600_000);

/** A movement of a merchant wallet: positive they owe us more (a fee), negative a credit. */
async function wallet(merchantId: string, amount: number, day: string) {
  await post(prisma, {
    kind: amount > 0 ? 'order_fee' : 'cod_collected',
    idempotencyKey: key(),
    occurredAt: noon(day),
    lines: [
      { account: { type: 'merchant', merchantId }, amount },
      { account: amount > 0 ? { type: 'revenue' } : { type: 'bank' }, amount: -amount },
    ],
  });
}

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
});

afterAll(() => prisma.$disconnect());

describe('who owes us, by age', () => {
  it('ages a merchant debit first in, first out, as of a chosen day', async () => {
    await wallet(f.merchant.id, 1_000, '2026-06-01');
    await wallet(f.merchant.id, 500, '2026-08-01');
    await wallet(f.merchant.id, -1_200, '2026-09-01');
    await wallet(f.merchant.id, 300, '2026-10-01');
    // A merchant in credit is never listed.
    const other = await prisma.merchant.create({ data: { name: 'In credit' } });
    await wallet(other.id, 400, '2026-06-01');
    await wallet(other.id, -900, '2026-06-02');

    const oct = await receivablesAging(prisma, { day: '2026-10-01' });
    expect(oct.merchants).toHaveLength(1);
    // The 1,200 paid the 1,000 of June and 200 of August: 300 of August (61 days) and the
    // 300 booked that day (not yet due) are left.
    expect(oct.merchants[0]).toMatchObject({
      merchantId: f.merchant.id,
      balancePiastres: 600,
      buckets: { current: 300, d1_30: 0, d31_60: 0, d61_90: 300, over_90: 0 },
      oldestDay: '2026-08-01',
      oldestDays: 61,
      daysInDebit: 122,
    });
    expect(oct.total.total).toBe(600);

    // As of mid August nothing was paid yet: June is 75 days old, August 14.
    const aug = await receivablesAging(prisma, { day: '2026-08-15' });
    expect(aug.merchants[0]!.buckets).toEqual({
      current: 0,
      d1_30: 500,
      d31_60: 0,
      d61_90: 1_000,
      over_90: 0,
    });
    // On the day it was paid down... still in debit (300 of August).
    expect((await receivablesAging(prisma, { day: '2026-09-01' })).merchants[0]).toMatchObject({
      balancePiastres: 300,
      buckets: { d31_60: 300 },
    });

    // Account managers see only their merchants; the search looks at names.
    expect(
      (await receivablesAging(prisma, { day: '2026-10-01', merchantIds: [other.id] })).merchants,
    ).toHaveLength(0);
    expect(
      (await receivablesAging(prisma, { day: '2026-10-01', q: 'nobody' })).merchants,
    ).toHaveLength(0);
    expect(
      (await receivablesAging(prisma, { day: '2026-10-01', q: 'merch' })).merchants,
    ).toHaveLength(1);
  });

  it('lists received cheques under collection by their due day', async () => {
    const entry = await post(prisma, {
      kind: 'cheque_received',
      idempotencyKey: key(),
      occurredAt: noon('2026-09-01'),
      lines: [
        { account: { type: 'cheques_under_collection' }, amount: 5_000 },
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: -5_000 },
      ],
    });
    await prisma.cheque.create({
      data: {
        number: 1,
        direction: 'received',
        purpose: 'merchant',
        status: 'received',
        chequeNumber: '000123',
        bankName: 'NBE',
        partyName: 'Merchant',
        amountPiastres: 5_000,
        issueDate: new Date('2026-09-01T00:00:00Z'),
        dueDate: new Date('2026-09-20T00:00:00Z'),
        merchantId: f.merchant.id,
        bookEntryId: entry!.id,
        idempotencyKey: key(),
        createdById: admin,
      },
    });
    expect((await receivablesAging(prisma, { day: '2026-08-31' })).cheques).toHaveLength(0);
    expect((await receivablesAging(prisma, { day: '2026-09-10' })).cheques[0]).toMatchObject({
      label: 'CHQ-000001',
      band: 'current',
      amountPiastres: 5_000,
    });
    const late = await receivablesAging(prisma, { day: '2026-10-05' });
    expect(late.cheques[0]).toMatchObject({ daysLate: 15, band: 'd1_30' });
    expect(late.total.buckets.d1_30).toBe(5_000);
    await prisma.cheque.updateMany({ data: { status: 'cleared', clearedAt: noon('2026-10-06') } });
    expect((await receivablesAging(prisma, { day: '2026-10-05' })).cheques).toHaveLength(1);
    expect((await receivablesAging(prisma, { day: '2026-10-07' })).cheques).toHaveLength(0);
  });
});

describe('what we owe suppliers, by age', () => {
  it('ages open bills by their due day as they stood on the chosen day', async () => {
    const today = cairoDay(new Date());
    const bank = await byKey('bank');
    await post(prisma, {
      kind: 'capital_in',
      idempotencyKey: key(),
      lines: [
        { account: { id: bank.id }, amount: 10_000_000 },
        { account: { id: (await byKey('equity:capital')).id }, amount: -10_000_000 },
      ],
    });
    const rent = await byKey('expense:rent');
    const landlord = await createSupplier(prisma, {
      name: 'Landlord',
      defaultExpenseAccountId: rent.id,
      actorUserId: admin,
    });
    const printer = await createSupplier(prisma, {
      name: 'Printer',
      defaultExpenseAccountId: rent.id,
      actorUserId: admin,
    });
    const a = await recordBill(prisma, {
      supplierId: landlord.id,
      reference: 'R-1',
      billDate: addDays(today, -100),
      dueDate: addDays(today, -95),
      darkStoreId: f.store.id,
      netPiastres: 10_000,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    const b = await recordBill(prisma, {
      supplierId: printer.id,
      reference: 'P-1',
      billDate: addDays(today, -20),
      dueDate: addDays(today, 10),
      netPiastres: 5_000,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    const c = await recordBill(prisma, {
      supplierId: printer.id,
      reference: 'P-2',
      billDate: addDays(today, -50),
      dueDate: addDays(today, -40),
      netPiastres: 700,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await payBill(prisma, {
      billId: a.id,
      amountPiastres: 4_000,
      moneyAccountId: bank.id,
      reference: 'T1',
      day: addDays(today, -10),
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await payBill(prisma, {
      billId: b.id,
      amountPiastres: 5_000,
      moneyAccountId: bank.id,
      reference: 'T2',
      actorUserId: admin,
      idempotencyKey: key(),
    });
    await cancelBill(prisma, { billId: c.id, reason: 'Entered twice', actorUserId: admin });

    const now = await payablesAging(prisma, { day: today });
    expect(now.suppliers).toHaveLength(1);
    expect(now.suppliers[0]).toMatchObject({
      name: 'Landlord',
      total: 6_000,
      buckets: { over_90: 6_000 },
    });
    expect(now.suppliers[0]!.bills[0]).toMatchObject({ label: 'BILL-000001', daysLate: 95 });

    // Eleven days ago: nothing was paid or cancelled yet.
    const before = await payablesAging(prisma, { day: addDays(today, -11) });
    expect(before.total.total).toBe(10_000 + 5_000 + 700);
    const landlordRow = before.suppliers.find((s) => s.name === 'Landlord')!;
    expect(landlordRow.buckets.d61_90).toBe(10_000);
    const printerRow = before.suppliers.find((s) => s.name === 'Printer')!;
    expect(printerRow.buckets).toMatchObject({ current: 5_000, d1_30: 700 });

    // A store keeps only that store's bills; a bill dated later is not there yet.
    const store = await payablesAging(prisma, { day: addDays(today, -11), storeId: f.store.id });
    expect(store.suppliers.map((s) => s.name)).toEqual(['Landlord']);
    expect((await payablesAging(prisma, { day: addDays(today, -60) })).total.total).toBe(10_000);
    expect(
      (await payablesAging(prisma, { day: addDays(today, -11), storeIds: [] })).suppliers,
    ).toHaveLength(0);
  });
});

describe('payment reminders', () => {
  const at = (iso: string) => new Date(iso);
  const reminders = () =>
    prisma.merchantPaymentReminder.findMany({ orderBy: { createdAt: 'asc' } });

  beforeEach(async () => {
    await prisma.merchant.update({
      where: { id: f.merchant.id },
      data: { billingEmails: ['billing@merchant.eg'], emailLanguage: 'en' },
    });
    await setSetting(prisma, { key: 'receivables.reminder_max', value: 3, actorUserId: admin });
  });

  it('reminds after the first days, then every few days, up to the max, and stops once paid', async () => {
    await wallet(f.merchant.id, 2_000, '2026-10-01');
    // Two days in debit: too soon. Before the reminder hour: too early.
    expect((await runReceivableReminders(prisma, at('2026-10-03T10:00:00Z'))).sent).toBe(0);
    expect((await runReceivableReminders(prisma, at('2026-10-04T05:00:00Z'))).status).toBe(
      'too_early',
    );
    expect((await runReceivableReminders(prisma, at('2026-10-04T10:00:00Z'))).sent).toBe(1);
    // Twice the same day sends nothing more.
    expect((await runReceivableReminders(prisma, at('2026-10-04T11:00:00Z'))).sent).toBe(0);
    expect((await runReceivableReminders(prisma, at('2026-10-10T10:00:00Z'))).sent).toBe(0);
    expect((await runReceivableReminders(prisma, at('2026-10-11T10:00:00Z'))).sent).toBe(1);

    // Send reminder now: counts toward the max (3) and is idempotent per key.
    const k = key();
    const manual = await sendReminderNow(prisma, {
      merchantId: f.merchant.id,
      actorUserId: admin,
      idempotencyKey: k,
      now: at('2026-10-12T10:00:00Z'),
    });
    expect(manual).toMatchObject({ number: 3, created: true });
    expect(
      await sendReminderNow(prisma, {
        merchantId: f.merchant.id,
        actorUserId: admin,
        idempotencyKey: k,
        now: at('2026-10-12T10:00:00Z'),
      }),
    ).toMatchObject({ number: 3, created: false });
    // The max is reached: no more automatic reminders.
    expect((await runReceivableReminders(prisma, at('2026-10-30T10:00:00Z'))).sent).toBe(0);

    const sent = await reminders();
    expect(sent.map((r) => [r.number, r.manual, r.amountPiastres])).toEqual([
      [1, false, 2_000],
      [2, false, 2_000],
      [3, true, 2_000],
    ]);
    // Each one: a notification, an email and an audit row.
    expect(await prisma.notification.count({ where: { type: 'payment_reminder' } })).toBe(3);
    const emails = await prisma.emailOutbox.findMany({ where: { kind: 'payment_reminder' } });
    expect(emails).toHaveLength(3);
    expect(emails[0]!.toEmails).toEqual(['billing@merchant.eg']);
    expect(emails[0]!.subject).toContain('20.00');
    expect(await prisma.auditLog.count({ where: { action: 'finance.payment_reminder' } })).toBe(3);
    // The receivable row shows them.
    const row = (await receivablesAging(prisma, { day: '2026-10-30' })).merchants[0]!;
    expect(row.reminders.count).toBe(3);

    // Paid: nothing more, and Send reminder now is refused.
    await wallet(f.merchant.id, -2_000, '2026-10-31');
    await expect(
      sendReminderNow(prisma, {
        merchantId: f.merchant.id,
        actorUserId: admin,
        idempotencyKey: key(),
        now: at('2026-11-01T10:00:00Z'),
      }),
    ).rejects.toThrow('nothing_owed');
    // A new debit starts a new period from the first reminder.
    await wallet(f.merchant.id, 700, '2026-11-02');
    expect((await runReceivableReminders(prisma, at('2026-11-04T10:00:00Z'))).sent).toBe(0);
    expect((await runReceivableReminders(prisma, at('2026-11-05T10:00:00Z'))).sent).toBe(1);
    expect((await reminders()).at(-1)).toMatchObject({ number: 1, amountPiastres: 700 });
  });

  it('sends nothing while switched off, and respects the email opt out', async () => {
    await wallet(f.merchant.id, 2_000, '2026-10-01');
    await setSetting(prisma, {
      key: 'receivables.reminders_enabled',
      value: 0,
      actorUserId: admin,
    });
    expect(await runReceivableReminders(prisma, at('2026-10-20T10:00:00Z'))).toMatchObject({
      status: 'disabled',
      sent: 0,
    });
    await setSetting(prisma, {
      key: 'receivables.reminders_enabled',
      value: 1,
      actorUserId: admin,
    });
    await prisma.merchant.update({
      where: { id: f.merchant.id },
      data: { emailOptOuts: ['payment_reminder'] },
    });
    expect((await runReceivableReminders(prisma, at('2026-10-20T10:00:00Z'))).sent).toBe(1);
    expect(await prisma.emailOutbox.count()).toBe(0);
    expect(await prisma.notification.count({ where: { type: 'payment_reminder' } })).toBe(1);
  });
});

describe('debit notes', () => {
  const lastMonth = () => addMonths(cairoDay(new Date()).slice(0, 7), -1);

  async function invoiced() {
    await setSetting(prisma, { key: 'fee.vat_bp', value: 1_400, actorUserId: admin });
    const at = new Date(cairoDayStart(`${lastMonth()}-10`).getTime() + 3600_000);
    await post(prisma, {
      kind: 'order_fee',
      idempotencyKey: key(),
      occurredAt: at,
      lines: [
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: 11_400 },
        { account: { type: 'revenue' }, amount: -10_000 },
        { account: { type: 'vat_payable' }, amount: -1_400 },
      ],
    });
    await prepareInvoices(prisma, { month: lastMonth(), actorUserId: admin });
    return (await listInvoices(prisma))[0]!;
  }

  it('charges more after an invoice once a second person approves, fixed and numbered', async () => {
    const invoice = await invoiced();
    const before = await balanceOf(prisma, { type: 'merchant', merchantId: f.merchant.id });
    const asked = await submitDebitNote(prisma, {
      invoiceId: invoice.id,
      lines: [
        { kind: 'storage_fee', netPiastres: 3_000 },
        { kind: 'receiving_fee', quantity: 10, netPiastres: 1_001 },
      ],
      reason: 'Storage days missed in the month',
      darkStoreId: f.store.id,
      actorUserId: admin,
      idempotencyKey: key(),
    });
    // It raises what the merchant owes: it waits for a second person.
    expect(asked.status).toBe('pending');
    const requestId = asked.status === 'pending' ? asked.request.id : '';
    const request = await prisma.financeRequest.findUniqueOrThrow({ where: { id: requestId } });
    // 14% VAT, rounded half up per line: 420 + 140.14 → 140.
    expect(request).toMatchObject({
      kind: 'debit_note',
      amountPiastres: 3_000 + 420 + 1_001 + 140,
    });
    await expect(
      decideFinanceRequest(prisma, { requestId, approve: true, actorUserId: admin }),
    ).rejects.toThrow('same_person');
    await decideFinanceRequest(prisma, { requestId, approve: true, actorUserId: second });

    expect(await balanceOf(prisma, { type: 'merchant', merchantId: f.merchant.id })).toBe(
      before + 4_561,
    );
    const notes = (await listInvoices(prisma)).filter((i) => i.type === 'debit_note');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      label: 'DN-000001',
      original: 'INV-000001',
      netPiastres: 4_001,
      vatPiastres: 560,
      totalPiastres: 4_561,
    });
    const full = await getInvoice(prisma, invoice.id);
    expect(full.debitNotes.map((d) => d.label)).toEqual(['DN-000001']);
    expect(full.creditNotes).toHaveLength(0);
    const dn = await getInvoice(prisma, notes[0]!.id);
    expect(dn.lines.map((l) => [l.kind, l.quantity, l.netPiastres, l.vatPiastres])).toEqual([
      ['storage_fee', 1, 3_000, 420],
      ['receiving_fee', 10, 1_001, 140],
    ]);
    // Booked as fee income and VAT, tagged with the merchant and the store.
    const entry = await prisma.ledgerEntry.findFirstOrThrow({
      where: { kind: 'debit_note' },
      include: { lines: { include: { account: true } } },
    });
    expect(entry.lines.map((l) => [l.account.key, l.amountPiastres])).toEqual(
      expect.arrayContaining([
        [`merchant:${f.merchant.id}`, 4_561],
        ['revenue', -4_001],
        ['vat_payable', -560],
      ]),
    );
    expect(entry.lines.every((l) => l.merchantId === f.merchant.id)).toBe(true);
    expect(entry.lines.every((l) => l.darkStoreId === f.store.id)).toBe(true);
    // Fixed once issued.
    await expect(
      prisma.taxInvoice.update({ where: { id: notes[0]!.id }, data: { netPiastres: 1 } }),
    ).rejects.toThrow();
    // A debit note never uses up what a credit note may give back.
    await issueCreditNote(prisma, {
      invoiceId: invoice.id,
      amountPiastres: 10_000,
      reason: 'Whole invoice back',
      actorUserId: admin,
      idempotencyKey: key(),
    });

    // The VAT return counts it as sales with output VAT, shown apart.
    const month = cairoDay(entry.occurredAt).slice(0, 7);
    const ret = await vatReturn(prisma, month);
    expect(ret).toMatchObject({ debitNotesPiastres: 4_001, debitNoteVatPiastres: 560 });
    expect(ret).toMatchObject({ outputVatPiastres: 560, creditNoteVatPiastres: 1_400 });
    const report = await vatReport(prisma, Number(month.slice(0, 4)));
    // Output VAT of the month: the debit note's 560 less the credit note's 1,400.
    expect(report.months.find((m) => m.month === month)!.outputPiastres).toBe(560 - 1_400);
  });

  it('is issued at once while money in needs no second person, refuses bad input, and goes to ETA as type D', async () => {
    const invoice = await invoiced();
    await setSetting(prisma, { key: 'finance.approve_money_in', value: 0, actorUserId: admin });
    await expect(
      submitDebitNote(prisma, {
        invoiceId: 'nope',
        lines: [{ kind: 'order_fee', netPiastres: 100 }],
        reason: 'Missed fee here',
        actorUserId: admin,
        idempotencyKey: key(),
      }),
    ).rejects.toThrow('invoice_not_found');
    await expect(
      submitDebitNote(prisma, {
        invoiceId: invoice.id,
        lines: [{ kind: 'order_fee', netPiastres: 0 }],
        reason: 'Missed fee here',
        actorUserId: admin,
        idempotencyKey: key(),
      }),
    ).rejects.toThrow('invalid_amount');
    const k = key();
    const input = {
      invoiceId: invoice.id,
      lines: [{ kind: 'order_fee' as const, netPiastres: 1_000 }],
      reason: 'Missed order fee',
      actorUserId: admin,
      idempotencyKey: k,
    };
    expect((await submitDebitNote(prisma, input)).status).toBe('posted');
    // The same key twice books once.
    await submitDebitNote(prisma, input);
    expect(await prisma.taxInvoice.count({ where: { type: 'debit_note' } })).toBe(1);

    await updateCompanyProfile(prisma, {
      legalNameAr: 'شيبلي ناو',
      taxRegistrationNumber: '123456789',
      activityCode: '5320',
      governorate: 'Cairo',
      regionCity: 'Nasr City',
      street: 'Abbas El Akkad',
      buildingNumber: '10',
      itemCodes: Object.fromEntries(
        [
          'order_fee',
          'cod_fee',
          'failed_fee',
          'receiving_fee',
          'storage_fee',
          'return_fee',
          'adjustment',
        ].map((k2, i) => [k2, `EG-123456789-${i + 1}`]),
      ),
      etaEnabled: true,
      actorUserId: admin,
    });
    await createSignerKey(prisma, { actorUserId: admin });
    // Until the invoice is accepted the debit note waits for it.
    const first = await documentsToSign(prisma);
    expect(first.documents.map((d) => d.internalId)).toEqual(['INV-000001']);
    expect(first.blocked).toEqual([
      expect.objectContaining({ internalId: 'DN-000001', reason: 'original_not_sent' }),
    ]);
    await prisma.taxInvoice.update({
      where: { id: invoice.id },
      data: { etaStatus: 'signed', signature: 's' },
    });
    await recordEtaResult(prisma, { id: invoice.id, status: 'valid', uuid: 'UUID-INV' });
    const next = await documentsToSign(prisma);
    expect(next.documents.map((d) => d.internalId)).toEqual(['DN-000001']);
    expect(next.documents[0]!.canonical).toContain('"DOCUMENTTYPE""D"');
    expect(next.documents[0]!.canonical).toContain('UUID-INV');
  });
});
