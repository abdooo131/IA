import { cairoDay } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  dispatchEmails,
  EMAIL_MAX_ATTEMPTS,
  emailRetryWait,
  listEmails,
  type MailMessage,
  type Mailer,
  retryEmail,
  updateMerchantEmailSettings,
} from '../src/email';
import { invoiceEmail, payoutPaidEmail, statementEmail } from '../src/email-templates';
import { addMonths, createPayout, markPayoutPaid, post, prepareInvoices } from '../src/finance';
import { createFixture, prisma, readyToPay, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let admin: string;
let n = 0;
const key = () => `em-${++n}-${Math.random()}`;
/** The API makes the statement of account PDF when the email is sent; a stand in here. */
const renderAttachment = async (ref: string) => Buffer.from(`%PDF-1.4 ${ref}`);

/** Records emails instead of sending them; can be told to fail. */
class FakeMailer implements Mailer {
  enabled = true;
  fail = false;
  sent: MailMessage[] = [];
  async send(message: MailMessage) {
    if (this.fail) throw new Error('email server answered 451');
    this.sent.push(message);
  }
}

/** The merchant is owed some COD, so a payout can be made. */
async function owe(amount: number, at = new Date()) {
  await post(prisma, {
    kind: 'cod_collected',
    idempotencyKey: key(),
    occurredAt: at,
    lines: [
      { account: { type: 'bank' }, amount },
      { account: { type: 'merchant', merchantId: f.merchant.id }, amount: -amount },
    ],
  });
}

async function paidPayout(reference = 'TRX-1') {
  const payout = await createPayout(prisma, {
    merchantId: f.merchant.id,
    cutoffAt: new Date(),
    actorUserId: admin,
  });
  await readyToPay(payout.id, { uploaderId: admin, reference });
  await markPayoutPaid(prisma, { payoutId: payout.id, reference, actorUserId: admin });
  return payout;
}

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  admin = (
    await prisma.user.create({
      data: { email: 'a@t.eg', name: 'Admin', role: 'admin', passwordHash: 'x' },
    })
  ).id;
  await prisma.merchant.update({
    where: { id: f.merchant.id },
    data: { contactEmail: 'owner@merchant.eg' },
  });
});

afterAll(() => prisma.$disconnect());

describe('email templates', () => {
  it('renders every email in English and Arabic, escaped, with the brand colours', () => {
    const data = {
      merchantName: 'Nile <Pantry>',
      number: 'PAY-000007',
      amountPiastres: 123_456_78,
      reference: 'TRX & 1',
      paidAt: new Date('2026-11-01T10:00:00Z'),
    };
    const en = payoutPaidEmail({ lang: 'en', ...data });
    const ar = payoutPaidEmail({ lang: 'ar', ...data });
    expect(en.subject).toBe('Payout PAY-000007 is on its way');
    expect(en.html).toContain('dir="ltr"');
    expect(en.html).toContain('EGP 123,456.78');
    expect(en.html).toContain('Nile &lt;Pantry&gt;');
    expect(en.html).not.toContain('<Pantry>');
    expect(en.html).toContain('#082341');
    expect(ar.html).toContain('dir="rtl"');
    expect(ar.html).toContain('lang="ar"');
    expect(ar.subject).toContain('PAY-000007');
    expect(ar.html).toContain('<span dir="ltr" style="unicode-bidi:isolate">123,456.78</span> ج.م');
    expect(ar.text).toContain('\u2066123,456.78\u2069 ج.م');
    expect(en.text).toContain('TRX & 1');

    const s = statementEmail({
      lang: 'ar',
      merchantName: 'x',
      from: new Date('2026-10-01T00:00:00Z'),
      to: new Date('2026-10-08T00:00:00Z'),
      openingPiastres: 0,
      closingPiastres: 5_000,
      byKind: { cod_collected: 6_000, order_fee: -1_000 },
    });
    expect(s.html).toContain('رسوم الطلبات');
    expect(s.html).toContain('>-10.00</span> ج.م');
    const inv = invoiceEmail({
      lang: 'en',
      merchantName: 'x',
      label: 'INV-000001',
      month: '2026-10',
      netPiastres: 1000,
      vatPiastres: 140,
      totalPiastres: 1140,
    });
    expect(inv.subject).toBe('Tax invoice INV-000001 for October 2026');
    expect(inv.html).toContain('%BASE_URL%/merchant/invoices');
  });
});

describe('email outbox', () => {
  it('queues the payout notice and the statement with its CSV when a payout is paid', async () => {
    await owe(25_000);
    const payout = await paidPayout();
    const rows = await prisma.emailOutbox.findMany({ orderBy: { kind: 'asc' } });
    expect(rows.map((r) => [r.kind, r.toEmails, r.language])).toEqual([
      ['payout_paid', ['owner@merchant.eg'], 'ar'],
      ['statement', ['owner@merchant.eg'], 'ar'],
    ]);
    const statement = rows.find((r) => r.kind === 'statement')!;
    const [file] = statement.attachments as { filename: string; content: string }[];
    expect(file!.filename).toMatch(/^statement-\d{4}-\d{2}-\d{2}-PAY-000001\.csv$/);
    const csv = Buffer.from(file!.content, 'base64').toString('utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('cod_collected');
    expect(csv).toContain('250.00');
    expect(statement.idempotencyKey).toBe(`statement:${payout.id}`);
  });

  it('respects billing addresses, language and opt outs', async () => {
    await updateMerchantEmailSettings(prisma, {
      merchantId: f.merchant.id,
      billingEmails: ['Billing@Merchant.eg', 'cfo@merchant.eg'],
      language: 'en',
      optOuts: ['statement'],
      actorUserId: admin,
    });
    await owe(10_000);
    await paidPayout();
    const rows = await prisma.emailOutbox.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'payout_paid',
      language: 'en',
      toEmails: ['billing@merchant.eg', 'cfo@merchant.eg'],
    });
    expect(await prisma.auditLog.count({ where: { action: 'merchant.email_settings' } })).toBe(1);
    // Without any address nothing is queued.
    await prisma.merchant.update({
      where: { id: f.merchant.id },
      data: { billingEmails: [], contactEmail: null },
    });
    await owe(10_000);
    await paidPayout('TRX-2');
    expect(await prisma.emailOutbox.count()).toBe(1);
  });

  it('queues the monthly invoice email once', async () => {
    const lastMonth = addMonths(cairoDay(new Date()).slice(0, 7), -1);
    await post(prisma, {
      kind: 'order_fee',
      idempotencyKey: key(),
      occurredAt: new Date(`${lastMonth}-15T10:00:00Z`),
      merchantId: f.merchant.id,
      lines: [
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: 1140 },
        { account: { type: 'revenue' }, amount: -1000 },
        { account: { type: 'vat_payable' }, amount: -140 },
      ],
    });
    await prepareInvoices(prisma, { month: lastMonth, actorUserId: admin });
    await prepareInvoices(prisma, { month: lastMonth, actorUserId: admin });
    const rows = await prisma.emailOutbox.findMany({ where: { kind: 'invoice' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.subject).toContain('INV-000001');
  });

  it('sends each email once, with the web address filled in', async () => {
    const mailer = new FakeMailer();
    await owe(10_000);
    await paidPayout();
    const opts = { baseUrl: 'https://shiply.example/', renderAttachment };
    expect(await dispatchEmails(prisma, mailer, opts)).toEqual({ sent: 2, failed: 0, gaveUp: 0 });
    expect(await dispatchEmails(prisma, mailer, opts)).toEqual({ sent: 0, failed: 0, gaveUp: 0 });
    expect(mailer.sent).toHaveLength(2);
    const statement = mailer.sent.find((m) =>
      m.attachments?.some((a) => a.filename.endsWith('.csv')),
    )!;
    // The payout notice carries the statement of account PDF and the proof of transfer.
    const notice = mailer.sent.find((m) => m !== statement)!;
    expect(notice.attachments!.map((a) => [a.filename, a.contentType])).toEqual([
      ['SOA-000001.pdf', 'application/pdf'],
      ['POT-000001.pdf', 'application/pdf'],
    ]);
    expect(notice.attachments![0]!.content.toString('utf8')).toContain('payout_soa_pdf:');
    expect(notice.attachments![1]!.content.toString('utf8')).toMatch(/^%PDF/);
    expect(statement.html).toContain('https://shiply.example/brand/app-icon-192.png');
    expect(statement.html).not.toContain('%BASE_URL%');
    expect(statement.attachments![0]!.content.toString('utf8')).toContain('opening_balance');
    // Two runs at once never send the same email twice.
    await prisma.emailOutbox.updateMany({
      data: { status: 'pending', nextAttemptAt: new Date(0) },
    });
    mailer.sent = [];
    const both = await Promise.all([
      dispatchEmails(prisma, mailer, opts),
      dispatchEmails(prisma, mailer, opts),
    ]);
    expect(both[0]!.sent + both[1]!.sent).toBe(2);
    expect(mailer.sent).toHaveLength(2);
  });

  it('sends nothing while email is not set up', async () => {
    const mailer = new FakeMailer();
    mailer.enabled = false;
    await owe(10_000);
    await paidPayout();
    expect(await dispatchEmails(prisma, mailer, { baseUrl: 'x' })).toEqual({
      sent: 0,
      failed: 0,
      gaveUp: 0,
    });
    expect((await listEmails(prisma)).counts).toEqual({ pending: 2 });
  });

  it('tries again with growing waits, then gives up with an alert, and finance can retry', async () => {
    expect([1, 2, 3, 8, 20].map(emailRetryWait)).toEqual([
      30_000, 60_000, 120_000, 3_600_000, 3_600_000,
    ]);
    const mailer = new FakeMailer();
    mailer.fail = true;
    await updateMerchantEmailSettings(prisma, {
      merchantId: f.merchant.id,
      billingEmails: [],
      language: 'ar',
      optOuts: ['statement'],
      actorUserId: admin,
    });
    await owe(10_000);
    await paidPayout();
    let now = new Date();
    const errors: unknown[] = [];
    expect(
      await dispatchEmails(prisma, mailer, {
        baseUrl: 'x',
        now,
        renderAttachment,
        onError: (e) => errors.push(e),
      }),
    ).toEqual({ sent: 0, failed: 1, gaveUp: 0 });
    // Not due again before the wait is over.
    expect(
      await dispatchEmails(prisma, mailer, { baseUrl: 'x', now, renderAttachment }),
    ).toMatchObject({
      failed: 0,
    });
    for (let i = 2; i <= EMAIL_MAX_ATTEMPTS; i++) {
      now = new Date(now.getTime() + 3_600_000);
      await dispatchEmails(prisma, mailer, { baseUrl: 'x', now, renderAttachment });
    }
    const row = await prisma.emailOutbox.findFirstOrThrow();
    expect(row).toMatchObject({
      status: 'failed',
      attempts: EMAIL_MAX_ATTEMPTS,
      lastError: 'email server answered 451',
    });
    expect(await prisma.alert.count({ where: { type: 'email_failed' } })).toBe(1);
    expect(errors).toHaveLength(1);

    mailer.fail = false;
    await retryEmail(prisma, { emailId: row.id, actorUserId: admin });
    expect(await dispatchEmails(prisma, mailer, { baseUrl: 'x', renderAttachment })).toMatchObject({
      sent: 1,
    });
    await expect(retryEmail(prisma, { emailId: row.id, actorUserId: admin })).rejects.toThrow(
      'email_already_sent',
    );
  });
});
