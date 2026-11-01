import type { INestApplication } from '@nestjs/common';
import { addDays, cairoDay } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
let n = 0;
const key = () => `fc-${++n}-${Date.now()}`;

describe('finance controls end to end', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const account = (k: string) => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: k } });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetAndSeed(prisma);
  });

  it('lets each finance level do only its part, and closes months', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const finance = await agent('finance@shiplynow.local');
    const me = await prisma.user.findUniqueOrThrow({ where: { email: 'finance@shiplynow.local' } });
    const cib = await account('bank');

    // Money in waits for the admin; spending it is fine for finance.
    const capital = await finance
      .post('/finance/capital')
      .send({
        direction: 'in',
        moneyAccountId: cib.id,
        amountPiastres: 500_000,
        reference: 'Owner',
        idempotencyKey: key(),
      })
      .expect(201);
    await finance
      .post(`/finance/requests/${capital.body.requestId}/decide`)
      .send({ approve: true })
      .expect(403);
    await admin
      .post(`/finance/requests/${capital.body.requestId}/decide`)
      .send({ approve: true })
      .expect(201);

    // A viewer only reads.
    await admin.patch(`/admin/users/${me.id}`).send({ financeLevel: 'view' }).expect(200);
    await finance.get('/finance/controls').expect(200);
    const refused = await finance
      .post('/finance/expenses')
      .send({
        expenseAccountId: (await account('expense:rent')).id,
        paidFromAccountId: cib.id,
        amountPiastres: 10_000,
        reference: 'R1',
        memo: 'rent',
        idempotencyKey: key(),
      })
      .expect(403);
    expect(refused.body.error).toBe('finance_level_too_low');

    // A preparer records but cannot close months; an approver can, and only admin reopens.
    await admin.patch(`/admin/users/${me.id}`).send({ financeLevel: 'prepare' }).expect(200);
    const yesterday = addDays(cairoDay(new Date()), -1);
    await finance.post('/finance/books-lock').send({ day: yesterday }).expect(403);
    await admin.patch(`/admin/users/${me.id}`).send({ financeLevel: 'approve' }).expect(200);
    await finance.post('/finance/books-lock').send({ day: yesterday }).expect(201);
    const late = await finance
      .post('/finance/expenses')
      .send({
        expenseAccountId: (await account('expense:rent')).id,
        paidFromAccountId: cib.id,
        amountPiastres: 10_000,
        reference: 'R2',
        memo: 'late bill',
        day: yesterday,
        idempotencyKey: key(),
      })
      .expect(409);
    expect(late.body.error).toBe('books_closed');
    const reopen = { day: addDays(yesterday, -3), reason: 'Late rent bill' };
    expect((await finance.post('/finance/books-lock').send(reopen).expect(403)).body.error).toBe(
      'reopen_admin_only',
    );
    await admin.post('/finance/books-lock').send(reopen).expect(201);
    expect((await finance.get('/finance/controls').expect(200)).body.lock).toMatchObject({
      closedThrough: reopen.day,
    });
  });

  it('attaches receipts and lists the movements still missing one', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const finance = await agent('finance@shiplynow.local');
    const cib = await account('bank');
    const capital = await finance
      .post('/finance/capital')
      .send({
        direction: 'in',
        moneyAccountId: cib.id,
        amountPiastres: 500_000,
        reference: 'Owner',
        idempotencyKey: key(),
      })
      .expect(201);
    await admin
      .post(`/finance/requests/${capital.body.requestId}/decide`)
      .send({ approve: true })
      .expect(201);

    const photo = await finance
      .post('/photos?kind=receipt')
      .set('content-type', 'image/jpeg')
      .send(JPEG)
      .expect(201);
    // Finance uploads receipts only, never delivery proof.
    await finance
      .post('/photos?kind=delivery')
      .set('content-type', 'image/jpeg')
      .send(JPEG)
      .expect(400);
    const expense = await finance
      .post('/finance/expenses')
      .send({
        expenseAccountId: (await account('expense:rent')).id,
        paidFromAccountId: cib.id,
        amountPiastres: 20_000,
        reference: 'R3',
        memo: 'rent',
        idempotencyKey: key(),
        receiptPhotoId: photo.body.id,
      })
      .expect(201);
    expect(expense.body.status).toBe('posted');
    const missing = await finance.get('/finance/attachments/missing').expect(200);
    const ids = missing.body.entries.map((e: { id: string }) => e.id);
    expect(ids).not.toContain(expense.body.id);
    // The approved capital still lacks its bank slip.
    expect(missing.body.count).toBe(1);
    const capitalEntry = missing.body.entries[0].id;
    await finance
      .post('/finance/attachments')
      .send({ entryId: capitalEntry, photoId: photo.body.id })
      .expect(201);
    expect((await finance.get('/finance/attachments/missing').expect(200)).body.count).toBe(0);
    expect(
      (await finance.get(`/finance/entries/${capitalEntry}/attachments`).expect(200)).body,
    ).toHaveLength(1);
  });

  it('refuses free journal entries that would put money in a bank', async () => {
    const finance = await agent('finance@shiplynow.local');
    const res = await finance
      .post('/finance/journal-entries')
      .send({
        lines: [
          { accountId: (await account('bank')).id, debitPiastres: 1_000, creditPiastres: 0 },
          {
            accountId: (await account('other_income:general')).id,
            debitPiastres: 0,
            creditPiastres: 1_000,
          },
        ],
        reason: 'Found money',
        idempotencyKey: key(),
      })
      .expect(409);
    expect(res.body.error).toBe('money_account_not_allowed');
  });
});
