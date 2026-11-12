import type { EmailStatus, Prisma } from '@prisma/client';
import {
  EMAIL_KINDS,
  type EmailKind,
  type EmailLanguage,
  payoutNumber,
  proofNumber,
  soaNumber,
} from '@shiplynow/shared';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';
import {
  BASE_URL,
  egpText,
  invoiceEmail,
  payoutPaidEmail,
  type RenderedEmail,
  statementEmail,
} from './email-templates';
import { invoiceLabel } from './finance/invoices';
import { merchantStatement } from './finance/reports';

type Tx = Prisma.TransactionClient;

// Emails to merchants. The email is written to email_outbox in the same transaction as the
// event (a payout marked paid, an invoice issued), with an idempotency key, so the event and
// its email happen together or not at all and a repeat queues nothing. The API job sends
// what is due through the Mailer boundary and tries again with growing waits (30 seconds
// doubling, at most an hour, 10 tries, then failed with an email_failed admin alert).
// Without SMTP settings nothing is sent; rows wait until email is set up.

export interface MailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}
export interface MailMessage {
  to: string[];
  subject: string;
  html: string;
  text: string;
  attachments?: MailAttachment[];
}
/** What sends email (SMTP today); tests use a fake. */
export interface Mailer {
  readonly enabled: boolean;
  send(message: MailMessage): Promise<void>;
}

export const EMAIL_MAX_ATTEMPTS = 10;
const FIRST_WAIT_MS = 30_000;
const LONGEST_WAIT_MS = 3_600_000;
/** A row being sent is held this long, so another run does not send it at the same time. */
const LEASE_MS = 5 * 60_000;

/** How long to wait after the n-th failed try. */
export function emailRetryWait(attempts: number) {
  return Math.min(FIRST_WAIT_MS * 2 ** Math.max(0, attempts - 1), LONGEST_WAIT_MS);
}

interface StoredAttachment {
  filename: string;
  contentType: string;
  /** The file, base64; or empty when `ref` names a file made or read when the email is sent */
  content?: string;
  /** payout_proof:<payoutId> (read here) or payout_soa_pdf:<payoutId>:<en|ar> (made by the API) */
  ref?: string;
}

/** An attachment made or read when the email is sent, so large files are not copied. */
export interface RefAttachment {
  filename: string;
  contentType: string;
  ref: string;
}

/** Makes a referenced attachment the database cannot make itself (a PDF made by the API). */
export type AttachmentRenderer = (ref: string) => Promise<Buffer | null>;

/** Queues one email once per idempotency key (a repeat changes nothing). */
export async function queueEmail(
  tx: Db,
  input: {
    kind: EmailKind;
    merchantId?: string | null;
    to: string[];
    language: EmailLanguage;
    email: RenderedEmail;
    attachments?: MailAttachment[];
    refs?: RefAttachment[];
    idempotencyKey: string;
  },
) {
  if (!input.to.length) return null;
  const files: StoredAttachment[] = [
    ...(input.attachments ?? []).map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      content: a.content.toString('base64'),
    })),
    ...(input.refs ?? []).map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      ref: a.ref,
    })),
  ];
  const stored: StoredAttachment[] | undefined = files.length ? files : undefined;
  await tx.emailOutbox.createMany({
    data: [
      {
        kind: input.kind,
        merchantId: input.merchantId ?? null,
        toEmails: input.to,
        language: input.language,
        subject: input.email.subject,
        html: input.email.html,
        text: input.email.text,
        attachments: stored as unknown as Prisma.InputJsonValue,
        idempotencyKey: input.idempotencyKey,
      },
    ],
    skipDuplicates: true,
  });
  return tx.emailOutbox.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
}

// ─── merchant settings ─────────────────────────────────────────────────────────

/** Where and in which language a merchant gets an email kind, or null (opted out, no address). */
export async function merchantEmailTarget(db: Db, merchantId: string, kind: EmailKind) {
  const merchant = await db.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant) return null;
  if (merchant.emailOptOuts.includes(kind)) return null;
  const to = merchant.billingEmails.length
    ? merchant.billingEmails
    : merchant.contactEmail
      ? [merchant.contactEmail]
      : [];
  if (!to.length) return null;
  return {
    to,
    language: (merchant.emailLanguage === 'en' ? 'en' : 'ar') as EmailLanguage,
    name: merchant.name,
  };
}

export async function merchantEmailSettings(db: Db, merchantId: string) {
  const m = await db.merchant.findUnique({ where: { id: merchantId } });
  if (!m) throw new DomainError('merchant_not_found', 404);
  return {
    billingEmails: m.billingEmails,
    contactEmail: m.contactEmail,
    language: (m.emailLanguage === 'en' ? 'en' : 'ar') as EmailLanguage,
    optOuts: m.emailOptOuts.filter((k): k is EmailKind =>
      (EMAIL_KINDS as readonly string[]).includes(k),
    ),
  };
}

export async function updateMerchantEmailSettings(
  db: Db,
  input: {
    merchantId: string;
    billingEmails: string[];
    language: EmailLanguage;
    optOuts: EmailKind[];
    actorUserId: string;
  },
) {
  return inTransaction(db, async (tx) => {
    const before = await merchantEmailSettings(tx, input.merchantId);
    const billingEmails = [...new Set(input.billingEmails.map((e) => e.trim().toLowerCase()))];
    const optOuts = [...new Set(input.optOuts)];
    await tx.merchant.update({
      where: { id: input.merchantId },
      data: { billingEmails, emailLanguage: input.language, emailOptOuts: optOuts },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'merchant.email_settings',
      entityType: 'merchant',
      entityId: input.merchantId,
      before: {
        billingEmails: before.billingEmails,
        language: before.language,
        optOuts: before.optOuts,
      },
      after: { billingEmails, language: input.language, optOuts },
    });
    return merchantEmailSettings(tx, input.merchantId);
  });
}

// ─── emails for finance events ─────────────────────────────────────────────────

const BOM = String.fromCharCode(0xfeff);
const csvCell = (value: string | null) => {
  const text = value ?? '';
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const cairoStamp = (at: Date) => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
};
const plainEgp = (piastres: number) => egpText(piastres).replace(/,/g, '');

/** The statement as the CSV merchants download from the wallet (UTF-8 with a BOM for Excel). */
export function statementCsv(s: Awaited<ReturnType<typeof merchantStatement>>) {
  const rows: (string | null)[][] = [
    ['date_cairo', 'type', 'order', 'reference', 'amount_egp', 'balance_egp'],
    [cairoStamp(s.from), 'opening_balance', null, null, null, plainEgp(s.openingOwedPiastres)],
    ...s.lines.map((l) => [
      cairoStamp(l.at),
      l.kind,
      l.orderNumber,
      l.orderNumber ? null : l.memo,
      plainEgp(l.amountPiastres),
      plainEgp(l.balanceAfterPiastres),
    ]),
    [
      cairoStamp(new Date(s.to.getTime() - 1)),
      'closing_balance',
      null,
      null,
      null,
      plainEgp(s.closingOwedPiastres),
    ],
  ];
  return `${BOM}${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/**
 * After a payout is marked paid (same transaction): the payout notice and the statement for
 * the payout period (from the previous paid payout's cutoff, or the merchant's start, to this
 * cutoff) with the statement CSV attached. Each respects the merchant's opt outs.
 */
export async function queuePayoutEmails(tx: Tx, payoutId: string) {
  const payout = await tx.payout.findUniqueOrThrow({
    where: { id: payoutId },
    include: {
      merchant: { select: { id: true, createdAt: true } },
      statement: { select: { number: true } },
      proof: { select: { number: true, fileName: true, contentType: true } },
    },
  });
  if (payout.status !== 'paid' || !payout.paidAt) return;
  const notice = await merchantEmailTarget(tx, payout.merchantId, 'payout_paid');
  // The notice carries the statement of account (PDF in the merchant's language, made by the
  // API when the email is sent) and the proof of transfer.
  const refs: RefAttachment[] = [];
  if (notice && payout.statement)
    refs.push({
      filename: `${soaNumber(payout.statement.number)}.pdf`,
      contentType: 'application/pdf',
      ref: `payout_soa_pdf:${payout.id}:${notice.language}`,
    });
  if (notice && payout.proof) {
    const ext =
      payout.proof.contentType === 'application/pdf'
        ? 'pdf'
        : payout.proof.contentType === 'image/png'
          ? 'png'
          : 'jpg';
    refs.push({
      filename: `${proofNumber(payout.proof.number)}.${ext}`,
      contentType: payout.proof.contentType,
      ref: `payout_proof:${payout.id}`,
    });
  }
  if (notice)
    await queueEmail(tx, {
      kind: 'payout_paid',
      merchantId: payout.merchantId,
      to: notice.to,
      language: notice.language,
      email: payoutPaidEmail({
        lang: notice.language,
        merchantName: notice.name,
        number: payoutNumber(payout.number),
        amountPiastres: payout.amountPiastres,
        reference: payout.reference ?? '',
        paidAt: payout.paidAt,
        attached: refs.length > 0,
      }),
      refs,
      idempotencyKey: `payout_paid:${payout.id}`,
    });
  const target = await merchantEmailTarget(tx, payout.merchantId, 'statement');
  if (!target) return;
  const previous = await tx.payout.findFirst({
    where: {
      merchantId: payout.merchantId,
      status: 'paid',
      id: { not: payout.id },
      cutoffAt: { lt: payout.cutoffAt },
    },
    orderBy: { cutoffAt: 'desc' },
  });
  const from = previous?.cutoffAt ?? payout.merchant.createdAt;
  const statement = await merchantStatement(tx, payout.merchantId, from, payout.cutoffAt);
  const day = cairoStamp(from).slice(0, 10);
  await queueEmail(tx, {
    kind: 'statement',
    merchantId: payout.merchantId,
    to: target.to,
    language: target.language,
    email: statementEmail({
      lang: target.language,
      merchantName: target.name,
      from,
      to: payout.cutoffAt,
      openingPiastres: statement.openingOwedPiastres,
      closingPiastres: statement.closingOwedPiastres,
      byKind: statement.byKind,
    }),
    attachments: [
      {
        filename: `statement-${day}-${payoutNumber(payout.number)}.csv`,
        contentType: 'text/csv; charset=utf-8',
        content: Buffer.from(statementCsv(statement), 'utf8'),
      },
    ],
    idempotencyKey: `statement:${payout.id}`,
  });
}

/** After a monthly tax invoice is issued (same transaction): a notice with a link to print it. */
export async function queueInvoiceEmail(tx: Tx, invoiceId: string) {
  const invoice = await tx.taxInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (invoice.type !== 'invoice') return;
  const target = await merchantEmailTarget(tx, invoice.merchantId, 'invoice');
  if (!target) return;
  await queueEmail(tx, {
    kind: 'invoice',
    merchantId: invoice.merchantId,
    to: target.to,
    language: target.language,
    email: invoiceEmail({
      lang: target.language,
      merchantName: target.name,
      label: invoiceLabel('invoice', invoice.number),
      month: invoice.periodMonth ?? '',
      netPiastres: invoice.netPiastres,
      vatPiastres: invoice.vatPiastres,
      totalPiastres: invoice.totalPiastres,
    }),
    idempotencyKey: `invoice:${invoice.id}`,
  });
}

// ─── sending ───────────────────────────────────────────────────────────────────

/** A referenced attachment's bytes; one that cannot be made fails the try (it is retried). */
async function resolveAttachment(db: Db, ref: string, render?: AttachmentRenderer) {
  if (ref.startsWith('payout_proof:')) {
    const proof = await db.payoutProof.findUnique({
      where: { payoutId: ref.slice('payout_proof:'.length) },
      select: { data: true },
    });
    if (proof) return Buffer.from(proof.data);
  } else if (render) {
    const made = await render(ref);
    if (made) return made;
  }
  throw new Error(`attachment ${ref.split(':')[0]} not available`);
}

const withBase = (text: string, baseUrl: string) =>
  text.split(BASE_URL).join(baseUrl.replace(/\/+$/, ''));

export interface EmailDispatchResult {
  sent: number;
  failed: number;
  gaveUp: number;
}

/**
 * Sends what is due. Each row is claimed first (its next try moved past a lease, under
 * SKIP LOCKED), so two runs or two API instances never send the same row together; a sent
 * row is never sent again. Does nothing while the mailer is not configured.
 */
export async function dispatchEmails(
  db: Db,
  mailer: Mailer,
  opts: {
    baseUrl: string;
    now?: Date;
    batch?: number;
    onError?: (error: unknown) => void;
    /** Makes referenced attachments the database cannot make (the SOA PDF) */
    renderAttachment?: AttachmentRenderer;
  },
): Promise<EmailDispatchResult> {
  const result = { sent: 0, failed: 0, gaveUp: 0 };
  if (!mailer.enabled) return result;
  const now = opts.now ?? new Date();
  const claimed = await inTransaction(db, async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM email_outbox
      WHERE status = 'pending' AND next_attempt_at <= ${now}
      ORDER BY next_attempt_at ASC
      LIMIT ${opts.batch ?? 20}
      FOR UPDATE SKIP LOCKED`;
    if (!rows.length) return [];
    await tx.emailOutbox.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
    });
    return tx.emailOutbox.findMany({ where: { id: { in: rows.map((r) => r.id) } } });
  });
  for (const row of claimed) {
    try {
      const attachments: MailAttachment[] = [];
      for (const a of (row.attachments ?? []) as unknown as StoredAttachment[])
        attachments.push({
          filename: a.filename,
          contentType: a.contentType,
          content: a.ref
            ? await resolveAttachment(db, a.ref, opts.renderAttachment)
            : Buffer.from(a.content ?? '', 'base64'),
        });
      await mailer.send({
        to: row.toEmails,
        subject: row.subject,
        html: withBase(row.html, opts.baseUrl),
        text: withBase(row.text, opts.baseUrl),
        attachments,
      });
      await db.emailOutbox.updateMany({
        where: { id: row.id, status: 'pending' },
        data: { status: 'sent', sentAt: new Date(), attempts: row.attempts + 1, lastError: null },
      });
      result.sent++;
    } catch (error) {
      const attempts = row.attempts + 1;
      const giveUp = attempts >= EMAIL_MAX_ATTEMPTS;
      // Only the error text: never the addresses or the body.
      const message = (error as Error).message?.slice(0, 300) ?? 'send failed';
      await inTransaction(db, async (tx) => {
        await tx.emailOutbox.update({
          where: { id: row.id },
          data: {
            attempts,
            lastError: message,
            status: giveUp ? 'failed' : 'pending',
            nextAttemptAt: new Date(now.getTime() + emailRetryWait(attempts)),
          },
        });
        if (giveUp)
          await tx.alert.createMany({
            data: [
              {
                type: 'email_failed',
                key: `email_failed:${row.id}:${attempts}`,
                merchantId: row.merchantId,
                data: { emailId: row.id, kind: row.kind, error: message },
              },
            ],
            skipDuplicates: true,
          });
      });
      if (giveUp) result.gaveUp++;
      else result.failed++;
      opts.onError?.(error);
    }
  }
  return result;
}

/** Finance sends a failed (or waiting) email again now. A sent email is never sent twice. */
export async function retryEmail(db: Db, input: { emailId: string; actorUserId: string }) {
  return inTransaction(db, async (tx) => {
    const row = await tx.emailOutbox.findUnique({ where: { id: input.emailId } });
    if (!row) throw new DomainError('email_not_found', 404);
    if (row.status === 'sent') throw new DomainError('email_already_sent');
    await tx.emailOutbox.update({
      where: { id: row.id },
      data: { status: 'pending', attempts: 0, nextAttemptAt: new Date() },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'email.retry',
      entityType: 'email',
      entityId: row.id,
      before: { status: row.status, attempts: row.attempts },
      after: { status: 'pending', attempts: 0 },
    });
    return { status: 'pending' as const };
  });
}

/** The outbox, newest first; addresses are shown to finance and admin only. */
export async function listEmails(
  db: Db,
  filter: { status?: EmailStatus; merchantId?: string; take?: number } = {},
) {
  const [rows, counts] = await Promise.all([
    db.emailOutbox.findMany({
      where: { status: filter.status, merchantId: filter.merchantId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(filter.take ?? 100, 300),
      select: {
        id: true,
        kind: true,
        merchantId: true,
        toEmails: true,
        language: true,
        subject: true,
        status: true,
        attempts: true,
        nextAttemptAt: true,
        sentAt: true,
        lastError: true,
        createdAt: true,
        attachments: true,
      },
    }),
    db.emailOutbox.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);
  const merchants = await db.merchant.findMany({
    where: { id: { in: rows.flatMap((r) => (r.merchantId ? [r.merchantId] : [])) } },
    select: { id: true, name: true },
  });
  return {
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) as Partial<
      Record<EmailStatus, number>
    >,
    rows: rows.map(({ attachments, ...r }) => ({
      ...r,
      merchant: merchants.find((m) => m.id === r.merchantId) ?? null,
      attachments: ((attachments ?? []) as unknown as StoredAttachment[]).map((a) => a.filename),
    })),
  };
}

/** One email as it was (or will be) sent, for the preview. */
export async function emailPreview(db: Db, id: string, baseUrl: string) {
  const row = await db.emailOutbox.findUnique({ where: { id } });
  if (!row) throw new DomainError('email_not_found', 404);
  return { html: withBase(row.html, baseUrl), subject: row.subject };
}
