import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetAndSeed } from './helpers';

describe('record history', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const agent = async (email: string, password = 'demo-password-1') => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
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

  it('shows who changed a record, newest first, to admin; finance only for money records', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const finance = await agent('finance@shiplynow.local');
    const created = await finance
      .post('/finance/accounts')
      .send({ groupCode: 5400, nameEn: 'Phone bills', nameAr: 'فواتير موبايل' })
      .expect(201);
    await finance
      .patch(`/finance/accounts/${created.body.id}`)
      .send({ nameEn: 'Phone and internet' })
      .expect(200);

    const rows = (await finance.get(`/history/ledger_account/${created.body.id}`).expect(200)).body;
    expect(rows.map((r: { action: string }) => r.action)).toEqual([
      'finance.account_update',
      'finance.account_create',
    ]);
    expect(rows[0]).toMatchObject({
      actor: { role: 'finance' },
      before: { nameEn: 'Phone bills' },
      after: { nameEn: 'Phone and internet' },
    });
    await admin.get(`/history/ledger_account/${created.body.id}`).expect(200);

    const store = await prisma.darkStore.findFirstOrThrow();
    await finance.get(`/history/dark_store/${store.id}`).expect(403);
    await admin.get(`/history/dark_store/${store.id}`).expect(200);
    const staff = await agent('staff.newcairo@shiplynow.local');
    await staff.get(`/history/ledger_account/${created.body.id}`).expect(403);
  });
});
