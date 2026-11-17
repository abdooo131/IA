import { createHash, randomBytes } from 'node:crypto';
import type { FileStorage, Prisma } from '@prisma/client';
import type { Db } from '../client';
import { getSetting } from '../settings';

// ─── The FileStore boundary ──────────────────────────────────────────────────────
//
// Uploaded files (proof photos, receipts, payout proofs, contract copies, HR files) used to
// live only in Postgres (bytea). The owner chose Cloudflare R2 (2026-11-17): when R2 is
// configured new files go to the private bucket and the mover job copies the old ones there.
// Every row says where its bytes are (storage db or r2, storage_key) and every reader goes
// through readStoredFile, so the access checks in front of each reader never change.

/** One object in the store's listing (the orphan clean up reads it). */
export interface StoredObject {
  key: string;
  lastModified: Date;
}

/** Where file bytes are kept: the database (today) or an object store such as R2. */
export interface FileStore {
  /** db: the bytes stay in the row; r2: an object store reached through put and get */
  readonly location: FileStorage;
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** The object's bytes, or null when there is no such object */
  get(key: string): Promise<Buffer | null>;
  delete?(key: string): Promise<void>;
  /** Objects under a prefix, a page at a time (for the orphan clean up) */
  list?(
    prefix: string,
    cursor?: string,
  ): Promise<{ objects: StoredObject[]; cursor: string | null }>;
}

/**
 * Today's behaviour: bytes stay in the row's own column. It has no objects; put and get are
 * never called for it (storeFileBytes writes the column, readStoredFile reads it).
 */
export class DbFileStore implements FileStore {
  readonly location = 'db' as const;
  put(): Promise<void> {
    return Promise.reject(new Error('database files are written to their row'));
  }
  get(): Promise<Buffer | null> {
    return Promise.reject(new Error('database files are read from their row'));
  }
}

/** An in memory object store for tests; it can be told to lose or change what it keeps. */
export class FakeFileStore implements FileStore {
  readonly location = 'r2' as const;
  readonly objects = new Map<string, { bytes: Buffer; contentType: string; at: Date }>();
  /** Set to make get answer other bytes than were put (a failed copy) */
  corrupt = false;
  /** Set to make put fail (the bucket cannot be reached) */
  failPut = false;
  /** The time new objects are stamped with */
  now: () => Date = () => new Date();

  put(key: string, bytes: Buffer, contentType: string) {
    if (this.failPut) return Promise.reject(new Error('fake store: put failed'));
    this.objects.set(key, { bytes: Buffer.from(bytes), contentType, at: this.now() });
    return Promise.resolve();
  }
  get(key: string) {
    const o = this.objects.get(key);
    if (!o) return Promise.resolve(null);
    return Promise.resolve(this.corrupt ? Buffer.concat([o.bytes, Buffer.from([0])]) : o.bytes);
  }
  delete(key: string) {
    this.objects.delete(key);
    return Promise.resolve();
  }
  list(prefix: string) {
    const objects = [...this.objects.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, o]) => ({ key, lastModified: o.at }));
    return Promise.resolve({ objects, cursor: null });
  }
}

const DATABASE = new DbFileStore();
let active: FileStore = DATABASE;

/** Sets where new files go (the API sets R2 at start when configured); null: the database. */
export function useFileStore(store: FileStore | null) {
  active = store ?? DATABASE;
}

/** Where new files go now. */
export function currentFileStore(): FileStore {
  return active;
}

// ─── Every table that keeps file bytes ───────────────────────────────────────────

/** One file column: the table, its bytes and where they live. */
export interface FileSlot {
  table: string;
  id: string;
  data: string;
  storage: string;
  key: string;
  sha256: string;
  size: string;
  contentType: string;
  /** Start of the object keys: no names, only the kind of file and a random part */
  prefix: string;
}

const plain = (table: string, prefix: string): FileSlot => ({
  table,
  id: table === 'employee_photos' ? 'employee_id' : 'id',
  data: 'data',
  storage: 'storage',
  key: 'storage_key',
  sha256: 'sha256',
  size: 'size_bytes',
  contentType: 'content_type',
  prefix,
});

/**
 * Every bytea column of the schema (a test fails when a new one is not listed here, so a new
 * file table cannot skip the store).
 */
export const FILE_SLOTS = {
  photo: plain('photos', 'photos'),
  payoutProof: plain('payout_proofs', 'payout-proofs'),
  employeePhoto: plain('employee_photos', 'employee-photos'),
  employeeDocument: plain('employee_documents', 'employee-documents'),
  contractFile: plain('merchant_contract_files', 'contract-files'),
  hireDraftFile: plain('hire_draft_files', 'hire-draft-files'),
  leaveDocument: {
    table: 'leave_requests',
    id: 'id',
    data: 'document_data',
    storage: 'document_storage',
    key: 'document_storage_key',
    sha256: 'document_sha256',
    size: 'document_size_bytes',
    contentType: 'document_content_type',
    prefix: 'leave-documents',
  },
  violationEvidence: {
    table: 'violations',
    id: 'id',
    data: 'evidence_data',
    storage: 'evidence_storage',
    key: 'evidence_storage_key',
    sha256: 'evidence_sha256',
    size: 'evidence_size_bytes',
    contentType: 'evidence_content_type',
    prefix: 'violation-evidence',
  },
} as const satisfies Record<string, FileSlot>;
export type FileSlotName = keyof typeof FILE_SLOTS;

const sha256Of = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** An unguessable object key: the kind of file, the month and 128 random bits. */
export function newStorageKey(slot: FileSlotName, now = new Date()) {
  const month = now.toISOString().slice(0, 7).replace('-', '/');
  return `${FILE_SLOTS[slot].prefix}/${month}/${randomBytes(16).toString('hex')}`;
}

/** The columns a new file's row is written with (the six tables named data, storage...). */
export interface StoredFileFields {
  data: Uint8Array<ArrayBuffer> | null;
  storage: FileStorage;
  storageKey: string | null;
  sha256: string;
  sizeBytes: number;
}

/**
 * Keeps a new file where files go now: R2 when configured (the object is written first under
 * a new key, then the caller writes its row, usually in the transaction it always used; an
 * object whose row never committed is removed by the orphan clean up after a day), else the
 * row's own column as before.
 */
export async function storeFileBytes(
  slot: FileSlotName,
  bytes: Buffer | Uint8Array,
  contentType: string,
): Promise<StoredFileFields> {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sha256 = sha256Of(buf);
  const store = currentFileStore();
  if (store.location === 'db')
    return {
      data: new Uint8Array(buf),
      storage: 'db',
      storageKey: null,
      sha256,
      sizeBytes: buf.length,
    };
  const key = newStorageKey(slot);
  await store.put(key, buf, contentType);
  return { data: null, storage: store.location, storageKey: key, sha256, sizeBytes: buf.length };
}

/** A stored file's place: the row's bytes, or its key in the bucket. */
export interface StoredFileRef {
  storage: FileStorage;
  storageKey: string | null;
  data: Uint8Array | null;
}

/** What every reader selects to read a file of the six plain tables. */
export const FILE_REF_SELECT = { storage: true, storageKey: true, data: true } as const;

/** A stored file whose bytes cannot be read: a server problem (500, reported), never a refusal. */
export class FileNotAvailableError extends Error {
  constructor(reason: 'no_bytes' | 'store_not_configured' | 'object_missing') {
    super(`file_not_available: ${reason}`);
    this.name = 'FileNotAvailableError';
  }
}

/**
 * The bytes of a stored file, from wherever they live. Callers check access first, exactly as
 * before; this only fetches. A file in R2 while R2 is not configured, or an object that is
 * missing, throws FileNotAvailableError (500, reported to admin as a server problem).
 */
export async function readStoredFile(ref: StoredFileRef): Promise<Buffer> {
  if (ref.storage === 'db') {
    if (!ref.data) throw new FileNotAvailableError('no_bytes');
    return Buffer.from(ref.data);
  }
  const store = currentFileStore();
  if (store.location === 'db' || !ref.storageKey)
    throw new FileNotAvailableError('store_not_configured');
  const bytes = await store.get(ref.storageKey);
  if (!bytes) throw new FileNotAvailableError('object_missing');
  return bytes;
}

/** A leave request's document as a StoredFileRef (its columns carry a prefix). */
export const leaveDocumentRef = (r: {
  documentStorage: FileStorage;
  documentStorageKey: string | null;
  documentData: Uint8Array | null;
}): StoredFileRef => ({
  storage: r.documentStorage,
  storageKey: r.documentStorageKey,
  data: r.documentData,
});

/** A violation's evidence as a StoredFileRef. */
export const violationEvidenceRef = (r: {
  evidenceStorage: FileStorage;
  evidenceStorageKey: string | null;
  evidenceData: Uint8Array | null;
}): StoredFileRef => ({
  storage: r.evidenceStorage,
  storageKey: r.evidenceStorageKey,
  data: r.evidenceData,
});

// ─── Progress, the mover and the orphan clean up ─────────────────────────────────

/** Advisory lock of the file mover (API jobs), one instance moves at a time. */
export const FILE_MOVE_LOCK = 735_071;

const q = (name: string) => `"${name}"`;

/** How many files of each table are in the database and in R2 (admin's progress panel). */
export async function fileStorageStatus(db: Db) {
  const tables = [];
  for (const [name, slot] of Object.entries(FILE_SLOTS)) {
    const [row] = await db.$queryRawUnsafe<{ db: bigint; r2: bigint; db_bytes: bigint | null }[]>(
      `SELECT count(*) FILTER (WHERE ${q(slot.storage)} = 'db' AND ${q(slot.data)} IS NOT NULL) AS db,
              count(*) FILTER (WHERE ${q(slot.storage)} = 'r2') AS r2,
              sum(octet_length(${q(slot.data)})) AS db_bytes
       FROM ${q(slot.table)}`,
    );
    tables.push({
      slot: name as FileSlotName,
      inDatabase: Number(row!.db),
      inR2: Number(row!.r2),
      databaseBytes: Number(row!.db_bytes ?? 0),
    });
  }
  const failed = await db.alert.count({ where: { type: 'file_move_failed', resolvedAt: null } });
  return {
    store: currentFileStore().location,
    moveEnabled: (await getSetting(db, 'files.move_enabled')) === 1,
    tables,
    inDatabase: tables.reduce((s, t) => s + t.inDatabase, 0),
    inR2: tables.reduce((s, t) => s + t.inR2, 0),
    failed,
  };
}

export interface FileMoveResult {
  moved: number;
  failed: number;
  /** Not run: R2 not configured, files.move_enabled off or another instance holds the lock */
  skipped?: 'no_store' | 'disabled' | 'locked';
}

const failKey = (slot: FileSlot, id: string) => `file_move_failed:${slot.table}:${id}`;

/**
 * Copies files still in the database to R2, a few at a time (files.move_batch_size per run).
 * Each file is moved in its own short transaction under the mover's advisory lock with the row
 * locked: the bytes are written to a new key, read back and compared (size and SHA-256), and
 * only then does the row say r2 with its bytes emptied, in the same transaction. A failed check
 * leaves the row as it was and raises one file_move_failed alert (keyed per file, so repeats
 * raise nothing twice); such a file is retried once the alert is marked handled. Rows already in
 * R2 are never read again, so running twice moves nothing twice.
 */
export async function moveFilesToR2(
  db: Db & { $transaction: unknown },
  opts: { batch?: number } = {},
): Promise<FileMoveResult> {
  const store = currentFileStore();
  if (store.location === 'db') return { moved: 0, failed: 0, skipped: 'no_store' };
  if ((await getSetting(db, 'files.move_enabled')) !== 1)
    return { moved: 0, failed: 0, skipped: 'disabled' };
  let budget = opts.batch ?? (await getSetting(db, 'files.move_batch_size'));
  const result: FileMoveResult = { moved: 0, failed: 0 };
  const client = db as unknown as {
    $transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, o?: object): Promise<T>;
  };
  for (const slot of Object.values(FILE_SLOTS) as FileSlot[]) {
    if (budget <= 0) break;
    // Files whose copy failed wait until admin marks their alert handled.
    const ids = await db.$queryRawUnsafe<{ id: string }[]>(
      `SELECT t.${q(slot.id)} AS id FROM ${q(slot.table)} t
       WHERE t.${q(slot.storage)} = 'db' AND t.${q(slot.data)} IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.key = ('file_move_failed:${slot.table}:' || t.${q(slot.id)}) AND a.resolved_at IS NULL)
       ORDER BY t.${q(slot.id)} LIMIT $1`,
      budget,
    );
    for (const { id } of ids) {
      budget--;
      const outcome = await client.$transaction(
        async (tx) => {
          const [lock] = await tx.$queryRaw<
            { locked: boolean }[]
          >`SELECT pg_try_advisory_xact_lock(${FILE_MOVE_LOCK}) AS locked`;
          if (!lock?.locked) return 'locked' as const;
          const [row] = await tx.$queryRawUnsafe<
            { data: Uint8Array | null; content_type: string | null }[]
          >(
            `SELECT ${q(slot.data)} AS data, ${q(slot.contentType)} AS content_type
             FROM ${q(slot.table)} WHERE ${q(slot.id)} = $1 AND ${q(slot.storage)} = 'db'
             FOR UPDATE SKIP LOCKED`,
            id,
          );
          if (!row?.data) return 'gone' as const;
          const bytes = Buffer.from(row.data);
          const sha = sha256Of(bytes);
          const key = newStorageKey(
            (Object.keys(FILE_SLOTS) as FileSlotName[]).find((n) => FILE_SLOTS[n] === slot)!,
          );
          // A store that cannot be reached throws: the run stops (the job reports it) and the
          // row stays in the database; only a copy that reads back wrong is a file's own alert.
          await store.put(key, bytes, row.content_type ?? 'application/octet-stream');
          const back = await store.get(key);
          let problem: string | null = null;
          if (!back) problem = 'not_found_after_upload';
          else if (back.length !== bytes.length) problem = 'size_mismatch';
          else if (sha256Of(back) !== sha) problem = 'sha256_mismatch';
          if (problem) {
            if (store.delete) await store.delete(key).catch(() => undefined);
            await tx.alert.upsert({
              where: { key: failKey(slot, id) },
              create: {
                type: 'file_move_failed',
                key: failKey(slot, id),
                data: { table: slot.table, id, problem },
              },
              // A retry after admin marked it handled opens the same alert again.
              update: {
                resolvedAt: null,
                resolvedById: null,
                data: { table: slot.table, id, problem },
              },
            });
            return 'failed' as const;
          }
          await tx.$executeRawUnsafe(
            `UPDATE ${q(slot.table)} SET ${q(slot.storage)} = 'r2', ${q(slot.key)} = $2,
               ${q(slot.sha256)} = $3, ${q(slot.data)} = NULL,
               ${q(slot.size)} = COALESCE(${q(slot.size)}, $4)
             WHERE ${q(slot.id)} = $1`,
            id,
            key,
            sha,
            bytes.length,
          );
          return 'moved' as const;
        },
        { timeout: 120_000, maxWait: 10_000 },
      );
      if (outcome === 'locked') return { ...result, skipped: 'locked' };
      if (outcome === 'moved') result.moved++;
      if (outcome === 'failed') result.failed++;
    }
  }
  return result;
}

/** An object younger than this is never an orphan: its upload's row may still be committing. */
export const ORPHAN_AGE_MS = 24 * 3_600_000;

/**
 * Clears R2 objects no row names: uploads whose transaction rolled back, and files whose row was
 * deleted (a replaced employee photo, a removed contract copy, a finished hire draft, a fresh
 * start). An object older than a day without a row is noted in file_orphans the first time it is
 * seen, and deleted only files.orphan_keep_days later (default 30, as long as the nightly
 * database copies are kept), so a database restored from any kept copy still finds its files.
 * A key is looked up in every file table, since a hire moves a draft's key to the employee's
 * file; a key named again is taken off the list. A delete the bucket refuses (a bucket lock
 * rule) is left for a later run. Safe to run twice.
 */
export async function cleanOrphanFiles(db: Db, now = new Date()) {
  const store = currentFileStore();
  const result = { noted: 0, deleted: 0, refused: 0 };
  if (store.location === 'db' || !store.list || !store.delete) return result;
  const before = now.getTime() - ORPHAN_AGE_MS;
  const keepDays = await getSetting(db, 'files.orphan_keep_days');
  const dueBefore = new Date(now.getTime() - keepDays * 24 * 3_600_000);
  const slots = Object.values(FILE_SLOTS) as FileSlot[];
  for (const slot of slots) {
    let cursor: string | undefined;
    do {
      const page = await store.list(`${slot.prefix}/`, cursor);
      const old = page.objects.filter((o) => o.lastModified.getTime() < before).map((o) => o.key);
      if (old.length) {
        const used = new Set<string>();
        for (const s of slots) {
          const rows = await db.$queryRawUnsafe<{ key: string }[]>(
            `SELECT ${q(s.key)} AS key FROM ${q(s.table)} WHERE ${q(s.key)} = ANY($1::text[])`,
            old,
          );
          for (const r of rows) used.add(r.key);
        }
        if (used.size) await db.fileOrphan.deleteMany({ where: { key: { in: [...used] } } });
        const orphans = old.filter((k) => !used.has(k));
        if (orphans.length) {
          const added = await db.fileOrphan.createMany({
            data: orphans.map((key) => ({ key, firstSeenAt: now })),
            skipDuplicates: true,
          });
          result.noted += added.count;
          const due = await db.fileOrphan.findMany({
            where: { key: { in: orphans }, firstSeenAt: { lte: dueBefore } },
            select: { key: true },
          });
          for (const { key } of due) {
            try {
              await store.delete(key);
            } catch {
              result.refused++;
              continue;
            }
            await db.fileOrphan.delete({ where: { key } });
            result.deleted++;
          }
        }
      }
      cursor = page.cursor ?? undefined;
    } while (cursor);
  }
  return result;
}
