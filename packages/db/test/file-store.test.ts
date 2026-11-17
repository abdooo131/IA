import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cleanOrphanFiles,
  FakeFileStore,
  FILE_SLOTS,
  fileStorageStatus,
  moveFilesToR2,
  ORPHAN_AGE_MS,
  readStoredFile,
  useFileStore,
} from '../src/files';
import { createPayout, getPayoutProofFile, markPayoutPaid, post } from '../src/finance';
import { savePhoto } from '../src/photos';
import { setSetting } from '../src/settings';
import { prisma, readyToPay, resetDatabase } from './helpers';

const jpeg = (n: number) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, n, n + 1, n + 2]);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

let store: FakeFileStore;
let userId: string;

beforeEach(async () => {
  await resetDatabase();
  store = new FakeFileStore();
  useFileStore(null);
  userId = (
    await prisma.user.create({
      data: { email: 'files@t.eg', name: 'Files', role: 'finance', passwordHash: 'x' },
    })
  ).id;
});
afterEach(() => useFileStore(null));
afterAll(() => prisma.$disconnect());

const photo = (n: number) =>
  savePhoto(prisma, {
    kind: 'pack',
    contentType: 'image/jpeg',
    data: jpeg(n),
    actorUserId: userId,
  });

describe('every bytea column goes through the file store', () => {
  it('lists each table that keeps file bytes (a new file table must be added to FILE_SLOTS)', async () => {
    const columns = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type = 'bytea'
      ORDER BY table_name, column_name`;
    const covered = Object.values(FILE_SLOTS).map((s) => `${s.table}.${s.data}`);
    expect(columns.map((c) => `${c.table_name}.${c.column_name}`).sort()).toEqual(covered.sort());
    // Each slot's place columns exist.
    for (const s of Object.values(FILE_SLOTS)) {
      const have = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${s.table}`;
      const names = have.map((h) => h.column_name);
      for (const c of [s.id, s.data, s.storage, s.key, s.sha256, s.size, s.contentType])
        expect(names, `${s.table}.${c}`).toContain(c);
    }
  });
});

describe('uploads and reads', () => {
  it('keeps the bytes in the row without R2, as before', async () => {
    const p = await photo(1);
    const row = await prisma.photo.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.storage).toBe('db');
    expect(row.storageKey).toBeNull();
    expect(Buffer.from(row.data!)).toEqual(jpeg(1));
    expect(row.sha256).toBe(sha(jpeg(1)));
    expect(await readStoredFile(row)).toEqual(jpeg(1));
  });

  it('writes to R2 under an unguessable key when configured, and reads it back', async () => {
    useFileStore(store);
    const p = await photo(2);
    const row = await prisma.photo.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.storage).toBe('r2');
    expect(row.data).toBeNull();
    expect(row.sizeBytes).toBe(jpeg(2).length);
    expect(row.storageKey).toMatch(/^photos\/\d{4}\/\d{2}\/[0-9a-f]{32}$/);
    expect(store.objects.get(row.storageKey!)?.contentType).toBe('image/jpeg');
    expect(await readStoredFile(row)).toEqual(jpeg(2));
  });

  it('a file in R2 cannot be read once R2 is off (a server problem, never wrong bytes)', async () => {
    useFileStore(store);
    const p = await photo(3);
    useFileStore(null);
    const row = await prisma.photo.findUniqueOrThrow({ where: { id: p.id } });
    await expect(readStoredFile(row)).rejects.toThrow('file_not_available');
  });

  it('the database refuses a row whose bytes are nowhere', async () => {
    await expect(
      prisma.photo.create({
        data: { kind: 'pack', contentType: 'image/jpeg', sizeBytes: 1, storage: 'db' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.photo.create({
        data: { kind: 'pack', contentType: 'image/jpeg', sizeBytes: 1, storage: 'r2' },
      }),
    ).rejects.toThrow();
  });
});

describe('the mover', () => {
  it('copies database files to R2, checks them and empties the row; a second run does nothing', async () => {
    const a = await photo(4);
    const b = await photo(5);
    useFileStore(store);
    expect((await fileStorageStatus(prisma)).inDatabase).toBe(2);

    expect(await moveFilesToR2(prisma)).toEqual({ moved: 2, failed: 0 });
    for (const [id, n] of [
      [a.id, 4],
      [b.id, 5],
    ] as const) {
      const row = await prisma.photo.findUniqueOrThrow({ where: { id } });
      expect(row.storage).toBe('r2');
      expect(row.data).toBeNull();
      expect(row.sha256).toBe(sha(jpeg(n)));
      expect(await readStoredFile(row)).toEqual(jpeg(n));
    }
    const status = await fileStorageStatus(prisma);
    expect(status.inDatabase).toBe(0);
    expect(status.inR2).toBe(2);

    expect(await moveFilesToR2(prisma)).toEqual({ moved: 0, failed: 0 });
    expect(store.objects.size).toBe(2);
  });

  it('moves a few at a time (files.move_batch_size)', async () => {
    await photo(6);
    await photo(7);
    await photo(8);
    useFileStore(store);
    await setSetting(prisma, { key: 'files.move_batch_size', value: 2, actorUserId: null });
    expect((await moveFilesToR2(prisma)).moved).toBe(2);
    expect((await moveFilesToR2(prisma)).moved).toBe(1);
  });

  it('a copy that reads back wrong stays in the database with one alert, retried once handled', async () => {
    const p = await photo(9);
    useFileStore(store);
    store.corrupt = true;
    expect(await moveFilesToR2(prisma)).toEqual({ moved: 0, failed: 1 });
    const row = await prisma.photo.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.storage).toBe('db');
    expect(Buffer.from(row.data!)).toEqual(jpeg(9));
    const alerts = await prisma.alert.findMany({ where: { type: 'file_move_failed' } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.data).toEqual({ table: 'photos', id: p.id, problem: 'size_mismatch' });
    // The bad copy is not left behind.
    expect(store.objects.size).toBe(0);

    // Waiting for admin: not tried again, no second alert.
    expect(await moveFilesToR2(prisma)).toEqual({ moved: 0, failed: 0 });
    expect(await prisma.alert.count({ where: { type: 'file_move_failed' } })).toBe(1);

    // Handled but still failing: the same alert opens again.
    await prisma.alert.updateMany({ data: { resolvedAt: new Date() } });
    expect(await moveFilesToR2(prisma)).toEqual({ moved: 0, failed: 1 });
    expect(
      await prisma.alert.findMany({
        where: { type: 'file_move_failed' },
        select: { resolvedAt: true },
      }),
    ).toEqual([{ resolvedAt: null }]);

    store.corrupt = false;
    await prisma.alert.updateMany({ data: { resolvedAt: new Date() } });
    expect(await moveFilesToR2(prisma)).toEqual({ moved: 1, failed: 0 });
  });

  it('a store that cannot be reached stops the run and changes nothing', async () => {
    const p = await photo(10);
    useFileStore(store);
    store.failPut = true;
    await expect(moveFilesToR2(prisma)).rejects.toThrow('put failed');
    expect((await prisma.photo.findUniqueOrThrow({ where: { id: p.id } })).storage).toBe('db');
    expect(await prisma.alert.count()).toBe(0);
  });

  it('does nothing without R2 or while files.move_enabled is 0', async () => {
    await photo(11);
    expect(await moveFilesToR2(prisma)).toMatchObject({ moved: 0, skipped: 'no_store' });
    useFileStore(store);
    await setSetting(prisma, { key: 'files.move_enabled', value: 0, actorUserId: null });
    expect(await moveFilesToR2(prisma)).toMatchObject({ moved: 0, skipped: 'disabled' });
  });

  it("moves a paid payout's proof (the only change the frozen proof allows)", async () => {
    const merchant = await prisma.merchant.create({ data: { name: 'M' } });
    const viewer = await prisma.user.create({
      data: { email: 'v@t.eg', name: 'V', role: 'finance', passwordHash: 'x' },
    });
    await post(prisma, {
      kind: 'test_capital',
      idempotencyKey: 'cap',
      lines: [
        { account: { type: 'bank' }, amount: 1_000_000 },
        { account: { type: 'retained_earnings' }, amount: -1_000_000 },
      ],
    });
    await post(prisma, {
      kind: 'cod_collected',
      idempotencyKey: 'cod',
      lines: [
        { account: { type: 'bank' }, amount: 10_000 },
        { account: { type: 'merchant', merchantId: merchant.id }, amount: -10_000 },
      ],
    });
    const payout = await createPayout(prisma, {
      merchantId: merchant.id,
      cutoffAt: new Date(),
      actorUserId: userId,
    });
    await readyToPay(payout.id, { uploaderId: userId, viewerId: viewer.id });
    await markPayoutPaid(prisma, { payoutId: payout.id, actorUserId: userId });
    const before = await getPayoutProofFile(prisma, payout.id);

    useFileStore(store);
    expect(await moveFilesToR2(prisma)).toEqual({ moved: 1, failed: 0 });
    const proof = await prisma.payoutProof.findUniqueOrThrow({ where: { payoutId: payout.id } });
    expect(proof.storage).toBe('r2');
    expect((await getPayoutProofFile(prisma, payout.id)).data).toEqual(before.data);
    // Anything else on a paid proof stays fixed.
    await expect(
      prisma.payoutProof.update({ where: { id: proof.id }, data: { reference: 'other' } }),
    ).rejects.toThrow('payout_paid_frozen');
  });
});

describe('orphan clean up', () => {
  it('deletes objects no row names only files.orphan_keep_days after first seeing them', async () => {
    useFileStore(store);
    const kept = await photo(12);
    const keptKey = (await prisma.photo.findUniqueOrThrow({ where: { id: kept.id } })).storageKey!;
    const now = new Date();
    const old = new Date(now.getTime() - ORPHAN_AGE_MS - 60_000);
    const orphan = 'photos/2026/11/' + 'a'.repeat(32);
    const fresh = 'photos/2026/11/' + 'b'.repeat(32);
    store.objects.get(keptKey)!.at = old;
    store.objects.set(orphan, { bytes: jpeg(1), contentType: 'image/jpeg', at: old });
    // Younger than a day: its row may still be committing.
    store.objects.set(fresh, { bytes: jpeg(1), contentType: 'image/jpeg', at: now });

    // Noted, not deleted: a database restored from a backup of the last 30 days may name it.
    expect(await cleanOrphanFiles(prisma, now)).toEqual({ noted: 1, deleted: 0, refused: 0 });
    expect(await cleanOrphanFiles(prisma, now)).toEqual({ noted: 0, deleted: 0, refused: 0 });
    expect(store.objects.has(orphan)).toBe(true);

    const later = new Date(now.getTime() + 30 * 24 * 3_600_000);
    store.objects.get(fresh)!.at = old;
    expect(await cleanOrphanFiles(prisma, later)).toEqual({ noted: 1, deleted: 1, refused: 0 });
    expect([...store.objects.keys()].sort()).toEqual([keptKey, fresh].sort());
    expect(await prisma.fileOrphan.count()).toBe(1);

    // A file deleted from the database (a replaced photo) becomes an orphan the same way.
    await prisma.photo.delete({ where: { id: kept.id } });
    expect((await cleanOrphanFiles(prisma, later)).noted).toBe(1);
    expect(store.objects.has(keptKey)).toBe(true);
  });

  it('leaves a delete the bucket refuses (a bucket lock) for a later run', async () => {
    useFileStore(store);
    const old = new Date(Date.now() - 40 * 24 * 3_600_000);
    const orphan = 'photos/2026/10/' + 'c'.repeat(32);
    store.objects.set(orphan, { bytes: jpeg(1), contentType: 'image/jpeg', at: old });
    await prisma.fileOrphan.create({ data: { key: orphan, firstSeenAt: old } });
    store.delete = () => Promise.reject(new Error('locked'));
    expect(await cleanOrphanFiles(prisma)).toEqual({ noted: 0, deleted: 0, refused: 1 });
    expect(await prisma.fileOrphan.count()).toBe(1);
  });
});
