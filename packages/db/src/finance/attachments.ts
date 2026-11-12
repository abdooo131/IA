import type { Prisma, PrismaClient } from '@prisma/client';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { proofNumber } from '@shiplynow/shared';

// Attachments chosen inside a finance form (docs/ARCHITECTURE.md "Finance attachments"): each
// file (a phone photo shrunk by the browser, or a PDF) is uploaded first and waits unlinked;
// the form sends the ids with its body and the save links them to its entry, payout or request
// in the same transaction as the record. A request carries them to its posted entry, as the
// receipts always did (receiptsFor). Uploads never linked are deleted after a day.

export const FINANCE_FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
export const MAX_FINANCE_IMAGE_BYTES = 1_500_000;
export const MAX_FINANCE_PDF_BYTES = 5_242_880;
export const MAX_ATTACHMENTS = 10;
/** Unlinked uploads older than this are deleted by the job. */
export const UNLINKED_UPLOAD_HOURS = 24;

/** The first bytes every file of each allowed type starts with. */
function looksLike(contentType: string, data: Buffer) {
  const starts = (bytes: number[], at = 0) => bytes.every((b, i) => data[at + i] === b);
  if (contentType === 'image/jpeg') return starts([0xff, 0xd8, 0xff]);
  if (contentType === 'image/png') return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (contentType === 'image/webp')
    return starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8);
  if (contentType === 'application/pdf') return starts([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
  return false;
}

/** A plain file name: no path, no control characters, at most 120 characters. */
function cleanName(name: string | null | undefined) {
  if (!name) return null;
  const base = Array.from(name.split(/[\\/]/).pop()!)
    .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)
    .join('')
    .trim();
  return base ? base.slice(0, 120) : null;
}

/** Stores one uploaded receipt or document, unlinked until a form saves it. */
export async function saveFinanceFile(
  db: Db,
  input: { contentType: string; data: Buffer; fileName?: string | null; actorUserId: string },
) {
  const type = input.contentType.split(';')[0]!.trim().toLowerCase();
  if (!FINANCE_FILE_TYPES.includes(type)) throw new DomainError('file_type_not_allowed', 400);
  if (input.data.length === 0) throw new DomainError('file_empty', 400);
  const max = type === 'application/pdf' ? MAX_FINANCE_PDF_BYTES : MAX_FINANCE_IMAGE_BYTES;
  if (input.data.length > max) throw new DomainError('file_too_large', 400);
  if (!looksLike(type, input.data)) throw new DomainError('file_not_matching_type', 400);
  return db.photo.create({
    data: {
      kind: 'receipt',
      contentType: type,
      data: new Uint8Array(input.data),
      sizeBytes: input.data.length,
      fileName: cleanName(input.fileName),
      unlinked: true,
      createdById: input.actorUserId,
    },
    select: { id: true, contentType: true, fileName: true, sizeBytes: true },
  });
}

/** Removes one's own upload that no form saved yet (the form's remove button). */
export async function discardFinanceFile(db: Db, input: { id: string; actorUserId: string }) {
  const gone = await db.photo.deleteMany({
    where: { id: input.id, unlinked: true, createdById: input.actorUserId },
  });
  if (gone.count !== 1) throw new DomainError('attachment_not_found', 404);
  return { deleted: true };
}

/**
 * Takes the uploads for a record: each must exist, be the person's own and still unlinked.
 * The guarded UPDATE locks the rows, so two saves naming the same file cannot both take it.
 */
async function claim(tx: Prisma.TransactionClient, ids: string[], actorUserId: string) {
  const taken = await tx.photo.updateMany({
    where: { id: { in: ids }, unlinked: true, createdById: actorUserId, kind: 'receipt' },
    data: { unlinked: false },
  });
  if (taken.count === ids.length) return;
  const rows = await tx.photo.findMany({
    where: { id: { in: ids } },
    select: { id: true, createdById: true, kind: true },
  });
  if (rows.length !== ids.length || rows.some((r) => r.kind !== 'receipt'))
    throw new DomainError('attachment_not_found', 404);
  if (rows.some((r) => r.createdById !== actorUserId))
    throw new DomainError('attachment_not_yours', 403);
  throw new DomainError('attachment_already_linked');
}

export type AttachTarget = { entryId: string } | { payoutId: string } | { requestId: string };

/** The ids a form sent, without repeats; refuses more than MAX_ATTACHMENTS. */
export function attachmentIdsOf(ids: readonly string[] | null | undefined) {
  const unique = [...new Set(ids ?? [])];
  if (unique.length > MAX_ATTACHMENTS) throw new DomainError('too_many_attachments', 400);
  return unique;
}

/** Links uploads to one entry, payout or request (joins the caller's transaction). */
export async function linkAttachments(
  db: Db,
  input: { ids: readonly string[] | null | undefined; actorUserId: string; target: AttachTarget },
) {
  const ids = attachmentIdsOf(input.ids);
  if (ids.length === 0) return [];
  const entryId = 'entryId' in input.target ? input.target.entryId : null;
  const payoutId = 'payoutId' in input.target ? input.target.payoutId : null;
  const requestId = 'requestId' in input.target ? input.target.requestId : null;
  const id = (entryId ?? payoutId ?? requestId)!;
  return inTransaction(db, async (tx) => {
    await claim(tx, ids, input.actorUserId);
    for (const photoId of ids)
      await tx.financeReceipt.create({
        data: { photoId, entryId, payoutId, requestId, createdById: input.actorUserId },
      });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.receipt_attach',
      entityType: entryId ? 'ledger_entry' : payoutId ? 'payout' : 'finance_request',
      entityId: id,
      after: { photoIds: ids, count: ids.length },
    });
    return ids;
  });
}

/**
 * A record that holds one photo itself (petty cash, a cheque): an upload from the attachment
 * field is taken like any other (own, unlinked); a photo uploaded the earlier way is kept as is.
 */
export async function claimRecordPhoto(db: Db, photoId: string, actorUserId: string) {
  const photo = await db.photo.findUnique({
    where: { id: photoId },
    select: { unlinked: true },
  });
  if (!photo) throw new DomainError('attachment_not_found', 404);
  if (photo.unlinked) await inTransaction(db, (tx) => claim(tx, [photoId], actorUserId));
}

/** Where a posted or queued money movement keeps its files: the entry, else the request. */
export function movementTarget(result: unknown): AttachTarget | null {
  const r = result as {
    status?: string;
    entry?: { id?: string } | null;
    request?: { id?: string } | null;
    entryId?: string | null;
    requestId?: string | null;
    id?: string;
  } | null;
  if (!r) return null;
  if (r.request?.id) return { requestId: r.request.id };
  if (r.requestId) return { requestId: r.requestId };
  if (r.entry?.id) return { entryId: r.entry.id };
  if (r.entryId) return { entryId: r.entryId };
  return null;
}

/**
 * Runs a save and links the form's uploads to what it made, all in one transaction: a refused
 * file (not one's own, already linked) undoes the record too. Without files it just runs.
 */
export async function withAttachments<T>(
  db: PrismaClient,
  input: { ids: readonly string[] | null | undefined; actorUserId: string },
  work: (tx: Db) => Promise<T>,
  target: (result: T) => AttachTarget | null = movementTarget,
): Promise<T> {
  const ids = attachmentIdsOf(input.ids);
  if (ids.length === 0) return work(db);
  return db.$transaction(
    async (tx) => {
      const result = await work(tx);
      const where = target(result);
      if (!where) throw new DomainError('attachment_target_missing', 400);
      await linkAttachments(tx, { ids, actorUserId: input.actorUserId, target: where });
      return result;
    },
    { timeout: 30_000, maxWait: 10_000 },
  );
}

/** Deletes uploads no form saved within a day. Safe to run twice. */
export async function purgeUnlinkedUploads(db: Db, now: Date = new Date()) {
  const before = new Date(now.getTime() - UNLINKED_UPLOAD_HOURS * 3_600_000);
  // A file someone used elsewhere the earlier way is kept: nothing that points at it breaks.
  const deleted = await db.$executeRaw`
    DELETE FROM photos p
    WHERE p.unlinked AND p.created_at < ${before}
      AND NOT EXISTS (SELECT 1 FROM finance_receipts r WHERE r.photo_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM petty_cash_expenses x WHERE x.photo_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM cheques x WHERE x.photo_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM expense_claims x WHERE x.photo_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM basata_deposits x WHERE x.photo_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM orders x WHERE x.pack_photo_id = p.id)
      AND NOT EXISTS (SELECT 1 FROM deliveries x
                      WHERE x.proof_photo_id = p.id OR x.failed_photo_id = p.id)`;
  return { deleted };
}

export interface AttachmentView {
  photoId: string;
  at: string;
  by: string | null;
  contentType: string;
  fileName: string | null;
  kind?: string;
  /** Where the file opens when it is not a photo row (a payout's proof of transfer) */
  href?: string;
}

/**
 * Every file of a set of entries, payouts and requests: directly on them, through the request
 * an entry was posted from, and through the payout an entry pays. Oldest first, each once.
 */
export async function attachmentsFor(
  db: Db,
  where: { entryIds?: string[]; payoutIds?: string[]; requestIds?: string[] },
): Promise<AttachmentView[]> {
  const entryIds = where.entryIds ?? [];
  const requestIds = [...(where.requestIds ?? [])];
  const payoutIds = [...(where.payoutIds ?? [])];
  if (entryIds.length) {
    const [requests, entries] = await Promise.all([
      db.financeRequest.findMany({ where: { entryId: { in: entryIds } }, select: { id: true } }),
      db.ledgerEntry.findMany({ where: { id: { in: entryIds } }, select: { data: true } }),
    ]);
    requestIds.push(...requests.map((r) => r.id));
    for (const e of entries) {
      const payout = (e.data as { payoutId?: unknown } | null)?.payoutId;
      if (typeof payout === 'string') payoutIds.push(payout);
    }
  }
  const or: Prisma.FinanceReceiptWhereInput[] = [];
  if (entryIds.length) or.push({ entryId: { in: entryIds } });
  if (requestIds.length) or.push({ requestId: { in: requestIds } });
  if (payoutIds.length) or.push({ payoutId: { in: payoutIds } });
  if (or.length === 0) return [];
  const rows = await db.financeReceipt.findMany({
    where: { OR: or },
    include: {
      createdBy: { select: { name: true } },
      photo: { select: { contentType: true, fileName: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  // A payout's proof of transfer (POT) is a file of its own table; it counts as a receipt.
  const proofs = payoutIds.length
    ? await db.payoutProof.findMany({
        where: { payoutId: { in: [...new Set(payoutIds)] } },
        select: {
          id: true,
          payoutId: true,
          number: true,
          fileName: true,
          contentType: true,
          createdAt: true,
          uploadedBy: { select: { name: true } },
        },
      })
    : [];
  const seen = new Set<string>();
  const files: AttachmentView[] = rows.flatMap((r) => {
    if (seen.has(r.photoId)) return [];
    seen.add(r.photoId);
    return [
      {
        photoId: r.photoId,
        at: r.createdAt.toISOString(),
        by: r.createdBy.name,
        contentType: r.photo.contentType,
        fileName: r.photo.fileName,
      },
    ];
  });
  for (const p of proofs)
    files.push({
      photoId: `pot-${p.id}`,
      at: p.createdAt.toISOString(),
      by: p.uploadedBy.name,
      contentType: p.contentType,
      fileName: `${proofNumber(p.number)} ${p.fileName}`,
      href: `/api/finance/payouts/${p.payoutId}/proof`,
    });
  return files.sort((a, b) => a.at.localeCompare(b.at));
}

/** One photo a record holds itself (petty cash, a claim, a cheque) as an attachment. */
export async function photoAttachment(
  db: Db,
  photoId: string,
  at: Date,
  by: string | null,
): Promise<AttachmentView> {
  const p = await db.photo.findUnique({
    where: { id: photoId },
    select: { contentType: true, fileName: true },
  });
  return {
    photoId,
    at: at.toISOString(),
    by,
    contentType: p?.contentType ?? 'image/jpeg',
    fileName: p?.fileName ?? null,
  };
}
