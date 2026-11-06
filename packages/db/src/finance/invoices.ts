import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Prisma, type TaxInvoice } from '@prisma/client';
import {
  cairoDay,
  cairoDayStart,
  etaCanonical,
  etaDocument,
  type EtaObject,
} from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { getSetting } from '../settings';
import { addMonths } from './assets';
import { post } from './ledger';

type Tx = Prisma.TransactionClient;

// Tax invoices to merchants for our fees, and the e-invoice (ETA) flow:
//
//   month over ──prepare──▶ INV-000001 per merchant (amounts fixed from the ledger)
//      │                        │
//      │   credit note (second person) ──▶ CN-000001: books the reduction and the document
//      ▼                        ▼
//   signing program on the finance PC (USB token) asks for documents not sent yet,
//   signs each canonical text, sends the signatures back ──▶ signed
//      ──▶ the API job submits to ETA ──▶ submitted (uuid) ──▶ valid or invalid
//
// The fees themselves were booked when they happened; an invoice is the document for them.

/** The fee kinds an invoice can carry, with their descriptions on the invoice. */
export const FEE_KINDS: Record<string, { en: string; ar: string }> = {
  order_fee: { en: 'Delivery service fee', ar: 'رسوم خدمة التوصيل' },
  cod_fee: { en: 'Cash on delivery handling fee', ar: 'رسوم تحصيل الدفع عند الاستلام' },
  failed_fee: { en: 'Failed delivery fee', ar: 'رسوم محاولة توصيل فاشلة' },
  receiving_fee: { en: 'Receiving fee', ar: 'رسوم استلام البضاعة' },
  storage_fee: { en: 'Storage fee', ar: 'رسوم التخزين' },
  return_fee: { en: 'Return to merchant fee', ar: 'رسوم إرجاع البضاعة للتاجر' },
  adjustment: { en: 'Fee adjustment', ar: 'تسوية رسوم' },
  minimum_fee: { en: 'Monthly minimum fee top up', ar: 'استكمال الحد الأدنى الشهري للرسوم' },
};

export const invoiceLabel = (type: 'invoice' | 'credit_note', n: number) =>
  `${type === 'invoice' ? 'INV' : 'CN'}-${String(n).padStart(6, '0')}`;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// ─── company and merchant tax details ──────────────────────────────────────────

export async function companyProfile(db: Db) {
  return db.companyProfile.upsert({ where: { id: 'company' }, create: {}, update: {} });
}

export type CompanyProfileInput = Partial<{
  legalNameEn: string;
  legalNameAr: string;
  taxRegistrationNumber: string;
  activityCode: string;
  branchId: string;
  governorate: string;
  regionCity: string;
  street: string;
  buildingNumber: string;
  itemCodes: Record<string, string>;
  etaEnabled: boolean;
}>;

export async function updateCompanyProfile(
  db: Db,
  input: CompanyProfileInput & { actorUserId: string },
) {
  const { actorUserId, ...data } = input;
  return inTransaction(db, async (tx) => {
    const before = await companyProfile(tx);
    const after = await tx.companyProfile.update({
      where: { id: 'company' },
      data: { ...data, updatedById: actorUserId, updatedAt: new Date() },
    });
    const { signerKeyHash: _a, ...b } = before;
    const { signerKeyHash: _b, ...a } = after;
    await recordAudit(tx, {
      actorUserId,
      action: 'finance.company_profile',
      entityType: 'company_profile',
      entityId: 'company',
      before: b as unknown as Prisma.InputJsonValue,
      after: a as unknown as Prisma.InputJsonValue,
    });
    return after;
  });
}

/** A new key for the signing program; shown once, stored hashed. The old key stops working. */
export async function createSignerKey(db: Db, input: { actorUserId: string }) {
  const key = `snsk_${randomBytes(24).toString('base64url')}`;
  return inTransaction(db, async (tx) => {
    await companyProfile(tx);
    await tx.companyProfile.update({
      where: { id: 'company' },
      data: {
        signerKeyHash: createHash('sha256').update(key).digest('hex'),
        signerKeyCreatedAt: new Date(),
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.signer_key',
      entityType: 'company_profile',
      entityId: 'company',
      after: { created: true },
    });
    return { key };
  });
}

/** Whether a key sent by the signing program is the current one. */
export async function signerKeyValid(db: Db, key: string | undefined) {
  if (!key) return false;
  const profile = await companyProfile(db);
  if (!profile.signerKeyHash) return false;
  const a = Buffer.from(createHash('sha256').update(key).digest('hex'));
  const b = Buffer.from(profile.signerKeyHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function updateMerchantTax(
  db: Db,
  input: {
    merchantId: string;
    legalName?: string | null;
    taxRegistrationNumber?: string | null;
    taxGovernorate?: string | null;
    taxRegionCity?: string | null;
    taxStreet?: string | null;
    taxBuildingNumber?: string | null;
    actorUserId: string;
  },
) {
  const { merchantId, actorUserId, ...data } = input;
  if (data.taxRegistrationNumber && !/^\d{9}$/.test(data.taxRegistrationNumber))
    throw new DomainError('invalid_tax_number', 400);
  return inTransaction(db, async (tx) => {
    const before = await tx.merchant.findUnique({ where: { id: merchantId } });
    if (!before) throw new DomainError('merchant_not_found', 404);
    const after = await tx.merchant.update({ where: { id: merchantId }, data });
    await recordAudit(tx, {
      actorUserId,
      action: 'finance.merchant_tax',
      entityType: 'merchant',
      entityId: merchantId,
      before: {
        legalName: before.legalName,
        taxRegistrationNumber: before.taxRegistrationNumber,
      },
      after: { legalName: after.legalName, taxRegistrationNumber: after.taxRegistrationNumber },
    });
    return after;
  });
}

// ─── invoices ──────────────────────────────────────────────────────────────────

async function nextDocumentNumber(tx: Tx, type: 'invoice' | 'credit_note') {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'tax_invoices:' + type}))`;
  const last = await tx.taxInvoice.findFirst({
    where: { type },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  return (last?.number ?? 0) + 1;
}

/** A merchant's fees of a month per kind, from the ledger: count, net and VAT. */
export async function monthlyFees(db: Db | Tx, merchantId: string, month: string) {
  const from = cairoDayStart(`${month}-01`);
  const to = cairoDayStart(`${addMonths(month, 1)}-01`);
  const rows = await db.$queryRaw<
    { kind: string; entries: bigint; net: bigint | null; vat: bigint | null }[]
  >`
    SELECT e.kind, COUNT(DISTINCT e.id) AS entries,
      -SUM(l.amount_piastres) FILTER (WHERE a.key = 'revenue') AS net,
      -SUM(l.amount_piastres) FILTER (WHERE a.key = 'vat_payable') AS vat
    FROM ledger_entries e
      JOIN ledger_lines l ON l.entry_id = e.id
      JOIN ledger_accounts a ON a.id = l.account_id
    WHERE e.kind = ANY(${Object.keys(FEE_KINDS)})
      AND e.id IN (
        SELECT DISTINCT r.entry_id FROM ledger_lines r
        JOIN ledger_accounts ra ON ra.id = r.account_id
        WHERE ra.key = 'revenue' AND r.merchant_id = ${merchantId}
          AND r.occurred_at >= ${from} AND r.occurred_at < ${to})
    GROUP BY e.kind`;
  return rows
    .map((r) => ({
      kind: r.kind,
      quantity: Number(r.entries),
      netPiastres: Number(r.net ?? 0),
      vatPiastres: Number(r.vat ?? 0),
    }))
    .filter((r) => r.netPiastres > 0);
}

/**
 * Issues the month's invoice for every merchant charged fees in it (once per merchant and
 * month). Only a month that is over can be invoiced.
 */
export async function prepareInvoices(
  db: Db,
  input: { month: string; actorUserId: string; now?: Date },
) {
  if (!MONTH.test(input.month)) throw new DomainError('invalid_month', 400);
  const today = cairoDay(input.now ?? new Date());
  if (`${input.month}-01` > today || addMonths(input.month, 1) > today.slice(0, 7))
    throw new DomainError('month_not_over', 400);
  const merchants = await db.merchant.findMany({ select: { id: true, name: true } });
  let created = 0;
  for (const m of merchants) {
    const made = await inTransaction(db, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'invoice:' + m.id}))`;
      if (
        await tx.taxInvoice.findFirst({
          where: { type: 'invoice', merchantId: m.id, periodMonth: input.month },
        })
      )
        return false;
      const fees = await monthlyFees(tx, m.id, input.month);
      if (fees.length === 0) return false;
      const net = fees.reduce((s, f) => s + f.netPiastres, 0);
      const vat = fees.reduce((s, f) => s + f.vatPiastres, 0);
      const invoice = await tx.taxInvoice.create({
        data: {
          type: 'invoice',
          number: await nextDocumentNumber(tx, 'invoice'),
          merchantId: m.id,
          periodMonth: input.month,
          netPiastres: net,
          vatPiastres: vat,
          totalPiastres: net + vat,
          createdById: input.actorUserId,
          lines: {
            create: fees.map((f, i) => ({
              lineNo: i + 1,
              kind: f.kind,
              descriptionEn: FEE_KINDS[f.kind]!.en,
              descriptionAr: FEE_KINDS[f.kind]!.ar,
              quantity: f.quantity,
              netPiastres: f.netPiastres,
              vatPiastres: f.vatPiastres,
            })),
          },
        },
      });
      await recordAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'finance.invoice_issue',
        entityType: 'tax_invoice',
        entityId: invoice.id,
        after: {
          number: invoiceLabel('invoice', invoice.number),
          month: input.month,
          total: net + vat,
        },
      });
      return true;
    });
    if (made) created++;
  }
  return { month: input.month, created };
}

/** What credit notes already took back from an invoice. */
async function credited(tx: Tx | Db, invoiceId: string) {
  const sum = await tx.taxInvoice.aggregate({
    where: { originalId: invoiceId },
    _sum: { netPiastres: true },
  });
  return sum._sum.netPiastres ?? 0;
}

export interface CreditNoteInput {
  invoiceId: string;
  /** How much of the fees (before VAT) is given back */
  amountPiastres: number;
  reason: string;
  actorUserId: string;
  idempotencyKey: string;
}

/**
 * A credit note against an invoice: gives the merchant back part of the fees and the VAT
 * on them (booked against fee income and VAT), with its own document. Goes through the
 * second person rule (it changes what we owe a merchant).
 */
export async function issueCreditNote(db: Db, input: CreditNoteInput) {
  if (!Number.isSafeInteger(input.amountPiastres) || input.amountPiastres <= 0)
    throw new DomainError('invalid_amount', 400);
  if (input.reason.trim().length < 5) throw new DomainError('reason_required', 400);
  return inTransaction(db, async (tx) => {
    const key = `credit_note:${input.idempotencyKey}`;
    const seen = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (seen) return seen;
    await tx.$executeRaw`SELECT id FROM tax_invoices WHERE id = ${input.invoiceId} FOR UPDATE`;
    const invoice = await tx.taxInvoice.findUnique({ where: { id: input.invoiceId } });
    if (!invoice || invoice.type !== 'invoice') throw new DomainError('invoice_not_found', 404);
    if (input.amountPiastres > invoice.netPiastres - (await credited(tx, invoice.id)))
      throw new DomainError('more_than_invoiced');
    const vat = invoice.netPiastres
      ? Math.round((input.amountPiastres * invoice.vatPiastres) / invoice.netPiastres)
      : 0;
    const entry = await post(tx, {
      kind: 'credit_note',
      idempotencyKey: key,
      createdById: input.actorUserId,
      memo: input.reason,
      merchantId: invoice.merchantId,
      data: { invoiceId: invoice.id, reason: input.reason },
      lines: [
        { account: { type: 'revenue' }, amount: input.amountPiastres },
        { account: { type: 'vat_payable' }, amount: vat },
        {
          account: { type: 'merchant', merchantId: invoice.merchantId },
          amount: -(input.amountPiastres + vat),
        },
      ],
    });
    const note = await tx.taxInvoice.create({
      data: {
        type: 'credit_note',
        number: await nextDocumentNumber(tx, 'credit_note'),
        merchantId: invoice.merchantId,
        originalId: invoice.id,
        reason: input.reason.trim(),
        netPiastres: input.amountPiastres,
        vatPiastres: vat,
        totalPiastres: input.amountPiastres + vat,
        entryId: entry!.id,
        createdById: input.actorUserId,
        lines: {
          create: [
            {
              lineNo: 1,
              kind: 'adjustment',
              descriptionEn: `${FEE_KINDS.adjustment!.en}: ${input.reason.trim()}`.slice(0, 500),
              descriptionAr: `${FEE_KINDS.adjustment!.ar}: ${input.reason.trim()}`.slice(0, 500),
              quantity: 1,
              netPiastres: input.amountPiastres,
              vatPiastres: vat,
            },
          ],
        },
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.credit_note',
      entityType: 'tax_invoice',
      entityId: note.id,
      after: {
        number: invoiceLabel('credit_note', note.number),
        invoice: invoiceLabel('invoice', invoice.number),
        amount: input.amountPiastres,
        vat,
      },
    });
    return entry!;
  });
}

export async function listInvoices(
  db: Db,
  filter: { merchantId?: string; month?: string; status?: string } = {},
) {
  const rows = await db.taxInvoice.findMany({
    where: {
      merchantId: filter.merchantId,
      periodMonth: filter.month,
      etaStatus: filter.status as TaxInvoice['etaStatus'] | undefined,
    },
    orderBy: [{ issuedAt: 'desc' }, { number: 'desc' }],
    take: 500,
    include: {
      merchant: { select: { id: true, name: true, legalName: true } },
      original: { select: { type: true, number: true } },
    },
  });
  return rows.map(view);
}

function view(
  r: TaxInvoice & {
    merchant: { id: string; name: string; legalName: string | null };
    original: { type: TaxInvoice['type']; number: number } | null;
  },
) {
  return {
    id: r.id,
    type: r.type,
    label: invoiceLabel(r.type, r.number),
    merchant: r.merchant,
    periodMonth: r.periodMonth,
    issuedAt: r.issuedAt,
    original: r.original ? invoiceLabel(r.original.type, r.original.number) : null,
    reason: r.reason,
    netPiastres: r.netPiastres,
    vatPiastres: r.vatPiastres,
    totalPiastres: r.totalPiastres,
    etaStatus: r.etaStatus,
    etaUuid: r.etaUuid,
    etaLongId: r.etaLongId,
    etaError: r.etaError,
  };
}

export async function getInvoice(db: Db, id: string) {
  const r = await db.taxInvoice.findUnique({
    where: { id },
    include: {
      merchant: true,
      original: { select: { type: true, number: true } },
      lines: { orderBy: { lineNo: 'asc' } },
      creditNotes: { select: { id: true, type: true, number: true, totalPiastres: true } },
    },
  });
  if (!r) throw new DomainError('invoice_not_found', 404);
  return {
    ...view({
      ...r,
      merchant: { id: r.merchant.id, name: r.merchant.name, legalName: r.merchant.legalName },
    }),
    receiver: {
      name: r.merchant.legalName ?? r.merchant.name,
      taxRegistrationNumber: r.merchant.taxRegistrationNumber,
      address: [
        r.merchant.taxStreet,
        r.merchant.taxBuildingNumber,
        r.merchant.taxRegionCity,
        r.merchant.taxGovernorate,
      ]
        .filter(Boolean)
        .join(', '),
    },
    lines: r.lines,
    creditNotes: r.creditNotes.map((c) => ({
      id: c.id,
      label: invoiceLabel(c.type, c.number),
      totalPiastres: c.totalPiastres,
    })),
    company: await companyProfile(db),
  };
}

// ─── the e-invoice flow ────────────────────────────────────────────────────────

/** What still stops invoices from going to the e-invoice system. */
export async function etaReadiness(db: Db) {
  const p = await companyProfile(db);
  const missing: string[] = [];
  if (!p.etaEnabled) missing.push('eta_off');
  for (const [field, value] of [
    ['legal_name', p.legalNameAr || p.legalNameEn],
    ['tax_registration_number', p.taxRegistrationNumber],
    ['activity_code', p.activityCode],
    ['governorate', p.governorate],
    ['region_city', p.regionCity],
    ['street', p.street],
    ['building_number', p.buildingNumber],
  ] as const)
    if (!value) missing.push(field);
  if (!p.signerKeyHash) missing.push('signer_key');
  const codes = p.itemCodes as Record<string, string>;
  // The monthly minimum needs its item code only once some contract has a minimum.
  const minimumUsed =
    (await db.merchantContract.count({ where: { minimumMonthlyFeePiastres: { gt: 0 } } })) > 0;
  const missingCodes = Object.keys(FEE_KINDS).filter(
    (k) => !codes[k] && (k !== 'minimum_fee' || minimumUsed),
  );
  return { ready: missing.length === 0 && missingCodes.length === 0, missing, missingCodes };
}

async function buildDocument(db: Db | Tx, id: string) {
  const r = await db.taxInvoice.findUniqueOrThrow({
    where: { id },
    include: { merchant: true, lines: { orderBy: { lineNo: 'asc' } }, original: true },
  });
  const p = await companyProfile(db as Db);
  const codes = p.itemCodes as Record<string, string>;
  const m = r.merchant;
  const company = Boolean(m.taxRegistrationNumber);
  if (r.type === 'credit_note' && !r.original?.etaUuid) return { blocked: 'original_not_sent' };
  if (company && !(m.taxGovernorate && m.taxRegionCity && m.taxStreet && m.taxBuildingNumber))
    return { blocked: 'merchant_address_missing' };
  const vatRate = (await getSetting(db as Db, 'fee.vat_bp')) / 100;
  const doc = etaDocument({
    type: r.type === 'invoice' ? 'I' : 'C',
    issuer: {
      type: 'B',
      id: p.taxRegistrationNumber,
      name: p.legalNameAr || p.legalNameEn,
      governorate: p.governorate,
      regionCity: p.regionCity,
      street: p.street,
      buildingNumber: p.buildingNumber,
      branchId: p.branchId,
    },
    receiver: {
      type: company ? 'B' : 'P',
      id: m.taxRegistrationNumber ?? '',
      name: m.legalName ?? m.name,
      governorate: m.taxGovernorate ?? '',
      regionCity: m.taxRegionCity ?? '',
      street: m.taxStreet ?? '',
      buildingNumber: m.taxBuildingNumber ?? '',
    },
    issuedAt: r.issuedAt,
    activityCode: p.activityCode,
    internalId: invoiceLabel(r.type, r.number),
    references: r.type === 'credit_note' ? [r.original!.etaUuid!] : undefined,
    lines: r.lines.map((l) => ({
      description: l.descriptionAr || l.descriptionEn,
      itemCode: codes[l.kind] ?? codes.adjustment ?? '',
      internalCode: l.kind,
      quantity: l.quantity,
      netPiastres: l.netPiastres,
      vatPiastres: l.vatPiastres,
      // The rate the fee was charged at, from its own amounts (the setting may have changed).
      vatRate: l.netPiastres ? Math.round((l.vatPiastres * 10_000) / l.netPiastres) / 100 : vatRate,
    })),
  });
  return { document: doc };
}

/**
 * Documents waiting for a signature, with the exact text to sign (asked by the signing
 * program). Each document's text is fixed the first time it is handed out.
 */
export async function documentsToSign(db: Db, limit = 50) {
  const readiness = await etaReadiness(db);
  const blockers = readiness.missing.filter((m) => m !== 'signer_key');
  if (blockers.length || readiness.missingCodes.length)
    return {
      ...readiness,
      ready: false,
      documents: [] as { id: string; internalId: string; canonical: string }[],
      blocked: [] as { id: string; internalId: string; reason: string }[],
    };
  const waiting = await db.taxInvoice.findMany({
    where: { etaStatus: 'not_sent' },
    orderBy: [{ type: 'asc' }, { number: 'asc' }],
    take: limit,
  });
  const documents: { id: string; internalId: string; canonical: string }[] = [];
  const blocked: { id: string; internalId: string; reason: string }[] = [];
  for (const r of waiting) {
    const internalId = invoiceLabel(r.type, r.number);
    if (r.canonical) {
      documents.push({ id: r.id, internalId, canonical: r.canonical });
      continue;
    }
    const built = await buildDocument(db, r.id);
    if ('blocked' in built) {
      blocked.push({ id: r.id, internalId, reason: built.blocked! });
      continue;
    }
    // The database keeps JSON fields in its own order, and ETA rebuilds the canonical text
    // from the JSON it receives, so the text is made from the stored copy we will send.
    const saved = await db.taxInvoice.update({
      where: { id: r.id },
      data: { document: built.document as unknown as Prisma.InputJsonValue },
    });
    const canonical = etaCanonical(saved.document as unknown as EtaObject);
    await db.taxInvoice.update({ where: { id: r.id }, data: { canonical } });
    documents.push({ id: r.id, internalId, canonical });
  }
  return { ...readiness, ready: true, documents, blocked };
}

/** Signatures sent back by the signing program. */
export async function saveSignatures(
  db: Db,
  input: { signatures: { id: string; signature: string }[] },
) {
  let saved = 0;
  for (const s of input.signatures) {
    const result = await db.taxInvoice.updateMany({
      where: { id: s.id, etaStatus: 'not_sent', canonical: { not: null } },
      data: { signature: s.signature, etaStatus: 'signed', etaError: Prisma.DbNull },
    });
    saved += result.count;
  }
  return { saved };
}

/** The signed document to submit: the document with its signature. */
export function signedDocument(r: Pick<TaxInvoice, 'document' | 'signature'>): EtaObject {
  return {
    ...(r.document as EtaObject),
    signatures: [{ signatureType: 'I', value: r.signature ?? '' }],
  };
}

/** Records what ETA answered for each submitted document. */
export async function recordEtaResult(
  db: Db,
  input: {
    id: string;
    status: 'submitted' | 'valid' | 'invalid' | 'rejected';
    uuid?: string;
    longId?: string;
    submissionId?: string;
    error?: unknown;
  },
) {
  return db.taxInvoice.update({
    where: { id: input.id },
    data: {
      etaStatus: input.status,
      etaUuid: input.uuid ?? undefined,
      etaLongId: input.longId ?? undefined,
      etaSubmissionId: input.submissionId ?? undefined,
      etaError: input.error === undefined ? undefined : (input.error as Prisma.InputJsonValue),
      etaCheckedAt: new Date(),
    },
  });
}

/**
 * A rejected document is corrected (its merchant's tax details, an item code) and sent
 * again: its text is rebuilt and it waits for a new signature.
 */
export async function resendInvoice(db: Db, input: { id: string; actorUserId: string }) {
  const r = await db.taxInvoice.findUnique({ where: { id: input.id } });
  if (!r) throw new DomainError('invoice_not_found', 404);
  if (r.etaStatus !== 'rejected' && r.etaStatus !== 'invalid')
    throw new DomainError('invoice_not_rejected');
  await db.taxInvoice.update({
    where: { id: r.id },
    data: {
      etaStatus: 'not_sent',
      canonical: null,
      signature: null,
      document: Prisma.DbNull,
    },
  });
  await recordAudit(db, {
    actorUserId: input.actorUserId,
    action: 'finance.invoice_resend',
    entityType: 'tax_invoice',
    entityId: r.id,
    before: { etaStatus: r.etaStatus },
    after: { etaStatus: 'not_sent' },
  });
  return { id: r.id };
}

/** Invoices whose last day is far back and still not valid (for the overview). */
export async function etaBacklog(db: Db) {
  const counts = await db.taxInvoice.groupBy({ by: ['etaStatus'], _count: { _all: true } });
  return Object.fromEntries(counts.map((c) => [c.etaStatus, c._count._all]));
}
