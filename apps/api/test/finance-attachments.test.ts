import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetAndSeed } from './helpers';

// Receipts and documents chosen inside a finance form: uploaded first (POST /finance/files),
// sent with the form as attachmentIds, linked in the record's own transaction.

const DEMO = 'demo-password-1';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
let n = 0;
const key = () => `att-${++n}-${Date.now()}`;

describe('finance attachments end to end', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const account = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });
  /** Money in the bank: the owner's capital, approved by the second person. */
  const fund = async (
    finance: Awaited<ReturnType<typeof agent>>,
    admin: Awaited<ReturnType<typeof agent>>,
  ) => {
    const capital = await finance
      .post('/finance/capital')
      .send({
        direction: 'in',
        moneyAccountId: (await account('bank')).id,
        amountPiastres: 1_000_000,
        reference: 'Owner',
        idempotencyKey: key(),
      })
      .expect(201);
    await admin
      .post(`/finance/requests/${capital.body.requestId}/decide`)
      .send({ approve: true })
      .expect(201);
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetAndSeed(prisma);
  });

  it('uploads photos and PDF files, links them with the entry and opens them', async () => {
    const finance = await agent('finance@shiplynow.local');
    const admin = await agent('admin@test.eg', 'admin-password-1');
    await fund(finance, admin);

    const pdf = await finance
      .post('/finance/files?name=invoice.pdf')
      .set('content-type', 'application/pdf')
      .send(PDF)
      .expect(201);
    expect(pdf.body).toMatchObject({ contentType: 'application/pdf', fileName: 'invoice.pdf' });
    const photo = await finance
      .post('/finance/files?name=slip.jpg')
      .set('content-type', 'image/jpeg')
      .send(JPEG)
      .expect(201);
    // Bytes that are not what they claim are refused.
    await finance
      .post('/finance/files')
      .set('content-type', 'application/pdf')
      .send(JPEG)
      .expect(400);

    const posted = await finance
      .post('/finance/expenses')
      .send({
        expenseAccountId: (await account('expense:rent')).id,
        paidFromAccountId: (await account('bank')).id,
        amountPiastres: 5_000,
        reference: 'R-7',
        memo: 'Store rent',
        attachmentIds: [pdf.body.id, photo.body.id],
        idempotencyKey: key(),
      })
      .expect(201);
    expect(posted.body.status).toBe('posted');

    const doc = await finance.get(`/finance/documents/ledger_entry/${posted.body.id}`).expect(200);
    expect(doc.body.attachments).toHaveLength(2);
    expect(doc.body.attachTarget).toEqual({ entryId: posted.body.id });
    expect(doc.body.smart.find((s: { key: string }) => s.key === 'receipts').count).toBe(2);

    // The PDF opens in the browser under its own name.
    const file = await finance.get(`/photos/${pdf.body.id}`).expect(200);
    expect(file.headers['content-type']).toContain('application/pdf');
    expect(file.headers['content-disposition']).toContain('invoice.pdf');

    // The same file again, or someone else's file, is refused and nothing is posted.
    const before = await prisma.ledgerEntry.count();
    const again = await finance
      .post('/finance/expenses')
      .send({
        expenseAccountId: (await account('expense:rent')).id,
        paidFromAccountId: (await account('bank')).id,
        amountPiastres: 4_000,
        reference: 'R-8',
        memo: 'Store rent',
        attachmentIds: [pdf.body.id],
        idempotencyKey: key(),
      })
      .expect(409);
    expect(again.body.error).toBe('attachment_already_linked');
    const adminFile = await admin
      .post('/finance/files')
      .set('content-type', 'image/jpeg')
      .send(JPEG)
      .expect(201);
    const theirs = await finance
      .post('/finance/expenses')
      .send({
        expenseAccountId: (await account('expense:rent')).id,
        paidFromAccountId: (await account('bank')).id,
        amountPiastres: 4_000,
        reference: 'R-9',
        memo: 'Store rent',
        attachmentIds: [adminFile.body.id],
        idempotencyKey: key(),
      })
      .expect(403);
    expect(theirs.body.error).toBe('attachment_not_yours');
    expect(await prisma.ledgerEntry.count()).toBe(before);

    // Added later from the entry page; an upload not saved yet can be removed.
    const later = await finance
      .post('/finance/files')
      .set('content-type', 'image/jpeg')
      .send(JPEG)
      .expect(201);
    await finance
      .post('/finance/attachments')
      .send({ entryId: posted.body.id, photoIds: [later.body.id] })
      .expect(201);
    const after = await finance
      .get(`/finance/documents/ledger_entry/${posted.body.id}`)
      .expect(200);
    expect(after.body.attachments).toHaveLength(3);
    const loose = await finance
      .post('/finance/files')
      .set('content-type', 'image/jpeg')
      .send(JPEG)
      .expect(201);
    await admin.delete(`/finance/files/${loose.body.id}`).expect(404);
    await finance.delete(`/finance/files/${loose.body.id}`).expect(200);

    // The printed voucher.
    const voucher = await finance
      .get(`/finance/journal/${posted.body.id}/voucher.pdf?lang=ar&kind=Expense`)
      .expect(200);
    expect(voucher.headers['content-type']).toContain('application/pdf');
  });

  it('keeps files on a request waiting for a second person, then on the posted entry', async () => {
    const finance = await agent('finance@shiplynow.local');
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const slip = await finance
      .post('/finance/files?name=deposit.pdf')
      .set('content-type', 'application/pdf')
      .send(PDF)
      .expect(201);
    // Money in waits for a second person (finance.approve_money_in).
    const capital = await finance
      .post('/finance/capital')
      .send({
        direction: 'in',
        moneyAccountId: (await account('bank')).id,
        amountPiastres: 500_000,
        reference: 'Owner',
        attachmentIds: [slip.body.id],
        idempotencyKey: key(),
      })
      .expect(201);
    expect(capital.body.status).toBe('pending');
    const request = await finance
      .get(`/finance/documents/finance_request/${capital.body.requestId}`)
      .expect(200);
    expect(request.body.attachments.map((a: { photoId: string }) => a.photoId)).toEqual([
      slip.body.id,
    ]);
    await admin
      .post(`/finance/requests/${capital.body.requestId}/decide`)
      .send({ approve: true })
      .expect(201);
    const decided = await prisma.financeRequest.findUniqueOrThrow({
      where: { id: capital.body.requestId },
    });
    const entry = await finance
      .get(`/finance/documents/ledger_entry/${decided.entryId}`)
      .expect(200);
    expect(entry.body.attachments.map((a: { photoId: string }) => a.photoId)).toEqual([
      slip.body.id,
    ]);
    expect(entry.body.data.approvedBy).toBeTruthy();
  });
});
