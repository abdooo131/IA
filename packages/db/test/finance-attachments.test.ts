import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  accountingDocument,
  attachmentsFor,
  decideFinanceRequest,
  ensureDefaultAccounts,
  linkAttachments,
  post,
  purgeUnlinkedUploads,
  recordCapital,
  saveFinanceFile,
  submitExpense,
  withAttachments,
} from '../src/finance';
import { createFixture, prisma, resetDatabase } from './helpers';

// Finance attachments chosen inside the form: uploads wait unlinked, the save links them in its
// own transaction, a request carries them to its posted entry, unused uploads go after a day.

let f: Awaited<ReturnType<typeof createFixture>>;
let alice: string;
let bob: string;
let n = 0;
const key = () => `a-${++n}-${Math.random()}`;
const byKey = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 1, 2, 3]);
const PDF = Buffer.from('%PDF-1.4\n%test\n');

const upload = (actorUserId: string, pdf = false) =>
  saveFinanceFile(prisma, {
    contentType: pdf ? 'application/pdf' : 'image/jpeg',
    data: pdf ? PDF : JPEG,
    fileName: pdf ? 'invoice.pdf' : 'photo.jpg',
    actorUserId,
  });

const expenseInput = async (amount: number, actorUserId = alice) => ({
  expenseAccountId: (await byKey('expense:rent')).id,
  paidFromAccountId: (await byKey('bank')).id,
  amountPiastres: amount,
  reference: 'INV-9',
  memo: 'Store rent',
  actorUserId,
  idempotencyKey: key(),
});

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  const user = (email: string, name: string) =>
    prisma.user.create({ data: { email, name, role: 'finance', passwordHash: 'x' } });
  alice = (await user('alice@t.eg', 'Alice')).id;
  bob = (await user('bob@t.eg', 'Bob')).id;
  await ensureDefaultAccounts(prisma);
  await prisma.setting.create({
    data: { key: 'finance.approval_threshold_piastres', scope: 'global', value: 1_000_000 },
  });
  await recordCapital(prisma, {
    direction: 'in',
    moneyAccountId: (await byKey('bank')).id,
    amountPiastres: 5_000_000,
    reference: 'Owner deposit',
    actorUserId: alice,
    idempotencyKey: key(),
  });
});

afterAll(() => prisma.$disconnect());

describe('finance uploads', () => {
  it('keeps photos and PDF files unlinked, and refuses other files', async () => {
    const pdf = await upload(alice, true);
    expect(pdf).toMatchObject({ contentType: 'application/pdf', fileName: 'invoice.pdf' });
    const row = await prisma.photo.findUniqueOrThrow({ where: { id: pdf.id } });
    expect(row).toMatchObject({ unlinked: true, kind: 'receipt', createdById: alice });
    await expect(
      saveFinanceFile(prisma, {
        contentType: 'application/pdf',
        data: JPEG,
        actorUserId: alice,
      }),
    ).rejects.toMatchObject({ code: 'file_not_matching_type' });
    await expect(
      saveFinanceFile(prisma, { contentType: 'text/html', data: PDF, actorUserId: alice }),
    ).rejects.toMatchObject({ code: 'file_type_not_allowed' });
    // A PDF may be up to 5 MB (a photo keeps the 1.5 MB limit).
    const big = Buffer.concat([PDF, Buffer.alloc(3_000_000)]);
    await expect(
      saveFinanceFile(prisma, { contentType: 'application/pdf', data: big, actorUserId: alice }),
    ).resolves.toMatchObject({ contentType: 'application/pdf' });
  });
});

describe('linking in the same transaction', () => {
  it('links the files to the posted entry and shows them on the journal page', async () => {
    const [a, b] = [await upload(alice), await upload(alice, true)];
    const result = await withAttachments(
      prisma,
      { ids: [a.id, b.id], actorUserId: alice },
      async (db) => submitExpense(db, await expenseInput(50_000)),
    );
    expect(result.status).toBe('posted');
    const entryId = (result as { entry: { id: string } }).entry.id;
    const files = await attachmentsFor(prisma, { entryIds: [entryId] });
    expect(files.map((x) => x.photoId).sort()).toEqual([a.id, b.id].sort());
    expect(files.find((x) => x.photoId === b.id)).toMatchObject({
      contentType: 'application/pdf',
      fileName: 'invoice.pdf',
    });
    const doc = await accountingDocument(prisma, 'ledger_entry', entryId);
    expect(doc!.attachments).toHaveLength(2);
    expect(doc!.smart.find((s) => s.key === 'receipts')!.count).toBe(2);
    expect(await prisma.photo.count({ where: { id: { in: [a.id, b.id] }, unlinked: true } })).toBe(
      0,
    );
  });

  it("refuses someone else's upload and undoes the record with it", async () => {
    const theirs = await upload(bob);
    const before = await prisma.ledgerEntry.count();
    await expect(
      withAttachments(prisma, { ids: [theirs.id], actorUserId: alice }, async (db) =>
        submitExpense(db, await expenseInput(40_000)),
      ),
    ).rejects.toMatchObject({ code: 'attachment_not_yours' });
    expect(await prisma.ledgerEntry.count()).toBe(before);
    expect((await prisma.photo.findUniqueOrThrow({ where: { id: theirs.id } })).unlinked).toBe(
      true,
    );
  });

  it('refuses a file already linked to another record', async () => {
    const file = await upload(alice);
    const first = await withAttachments(
      prisma,
      { ids: [file.id], actorUserId: alice },
      async (db) => submitExpense(db, await expenseInput(30_000)),
    );
    const entryId = (first as { entry: { id: string } }).entry.id;
    const before = await prisma.ledgerEntry.count();
    await expect(
      withAttachments(prisma, { ids: [file.id], actorUserId: alice }, async (db) =>
        submitExpense(db, await expenseInput(20_000)),
      ),
    ).rejects.toMatchObject({ code: 'attachment_already_linked' });
    expect(await prisma.ledgerEntry.count()).toBe(before);
    // Adding it again later, even to the same entry, is refused the same way.
    await expect(
      linkAttachments(prisma, { ids: [file.id], actorUserId: alice, target: { entryId } }),
    ).rejects.toMatchObject({ code: 'attachment_already_linked' });
    expect(await prisma.financeReceipt.count({ where: { photoId: file.id } })).toBe(1);
  });

  it('keeps the files on the request and carries them to the entry once approved', async () => {
    const file = await upload(alice, true);
    const result = await withAttachments(
      prisma,
      { ids: [file.id], actorUserId: alice },
      async (db) => submitExpense(db, await expenseInput(2_000_000)),
    );
    expect(result.status).toBe('pending');
    const requestId = (result as { request: { id: string } }).request.id;
    expect(await prisma.financeReceipt.count({ where: { requestId } })).toBe(1);
    const request = await accountingDocument(prisma, 'finance_request', requestId);
    expect(request!.attachments.map((x) => x.photoId)).toEqual([file.id]);

    await decideFinanceRequest(prisma, { requestId, approve: true, actorUserId: bob });
    const posted = await prisma.financeRequest.findUniqueOrThrow({ where: { id: requestId } });
    const doc = await accountingDocument(prisma, 'ledger_entry', posted.entryId!);
    expect(doc!.attachments.map((x) => x.photoId)).toEqual([file.id]);
    // Who made it and who approved it, for the voucher.
    expect(doc!.data).toMatchObject({ madeBy: 'Alice', approvedBy: 'Bob' });
    expect(doc!.fields.find((x) => x.key === 'approvedBy')?.value).toBe('Bob');
  });

  it('runs without files exactly as before', async () => {
    const result = await withAttachments(prisma, { ids: [], actorUserId: alice }, async (db) =>
      submitExpense(db, await expenseInput(10_000)),
    );
    expect(result.status).toBe('posted');
  });
});

describe('unused uploads', () => {
  it('deletes uploads no form saved within a day, never a linked one; twice is harmless', async () => {
    const old = await upload(alice);
    const used = await upload(alice);
    const fresh = await upload(alice);
    await withAttachments(prisma, { ids: [used.id], actorUserId: alice }, async (db) =>
      submitExpense(db, await expenseInput(10_000)),
    );
    const twoDaysAgo = new Date(Date.now() - 48 * 3_600_000);
    await prisma.photo.updateMany({
      where: { id: { in: [old.id, used.id] } },
      data: { createdAt: twoDaysAgo },
    });
    expect(await purgeUnlinkedUploads(prisma)).toEqual({ deleted: 1 });
    expect(await purgeUnlinkedUploads(prisma)).toEqual({ deleted: 0 });
    const left = await prisma.photo.findMany({
      where: { id: { in: [old.id, used.id, fresh.id] } },
      select: { id: true },
    });
    expect(left.map((x) => x.id).sort()).toEqual([used.id, fresh.id].sort());
  });
});

describe('journal entry page', () => {
  it('opens every kind of entry with its lines, owners and totals', async () => {
    // A delivery's entries (merchant, rider and store tags, wallets named after their owner)
    // and money movements (capital in the setup, an expense).
    const riderUser = await prisma.user.create({
      data: { email: 'r@t.eg', name: 'Rami', role: 'rider', passwordHash: 'x' },
    });
    const rider = await prisma.rider.create({
      data: { userId: riderUser.id, darkStoreId: f.store.id, badgeCode: 'RDR-7' },
    });
    await post(prisma, {
      kind: 'cod_collected',
      idempotencyKey: key(),
      darkStoreId: f.store.id,
      merchantId: f.merchant.id,
      riderId: rider.id,
      lines: [
        { account: { type: 'rider_cash', riderId: rider.id }, amount: 43_500 },
        { account: { type: 'merchant', merchantId: f.merchant.id }, amount: -43_500 },
      ],
    });
    await post(prisma, {
      kind: 'rider_bonus',
      idempotencyKey: key(),
      darkStoreId: f.store.id,
      riderId: rider.id,
      lines: [
        { account: { type: 'rider_bonus_expense' }, amount: 3_000 },
        { account: { type: 'rider_bonus', riderId: rider.id }, amount: -3_000 },
      ],
    });
    await submitExpense(prisma, await expenseInput(12_000));
    const kinds = await prisma.ledgerEntry.findMany({ select: { id: true, kind: true } });
    expect(kinds.length).toBeGreaterThan(0);
    for (const e of kinds) {
      const doc = await accountingDocument(prisma, 'ledger_entry', e.id);
      expect(doc, e.kind).not.toBeNull();
      const rows = doc!.lines!.rows;
      const debit = rows.reduce((s, r) => s + (Number(r.debit) || 0), 0);
      const credit = rows.reduce((s, r) => s + (Number(r.credit) || 0), 0);
      expect(debit).toBe(credit);
      expect(doc!.lines!.columns.map((c) => c.key)).toEqual([
        'account',
        'store',
        'merchant',
        'rider',
        'debit',
        'credit',
      ]);
      // A wallet with no name of its own shows its owner's name, never "null".
      for (const r of rows) expect(String(r.account)).not.toContain('null');
      expect(doc!.attachTarget).toEqual({ entryId: e.id });
    }
    expect(new Set(kinds.map((k) => k.kind))).toEqual(
      new Set(['capital_in', 'cod_collected', 'rider_bonus', 'expense']),
    );
    const cod = kinds.find((k) => k.kind === 'cod_collected')!;
    const doc = await accountingDocument(prisma, 'ledger_entry', cod.id);
    expect(doc!.lines!.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          account: expect.stringContaining('Rami (RDR-7)'),
          rider: 'Rami (RDR-7)',
          merchant: 'Merchant',
          debit: 43_500,
        }),
        expect.objectContaining({ account: expect.stringContaining('Merchant'), credit: 43_500 }),
      ]),
    );
  });
});
