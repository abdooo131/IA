import type { INestApplication } from '@nestjs/common';
import { addDays, cairoDay } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetAndSeed } from './helpers';

let n = 0;
const key = () => `fp-${++n}-${Date.now()}`;

describe('profit and salaries end to end', () => {
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

  it('pays salaries with an advance recovered, and shows profit per store', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const finance = await agent('finance@shiplynow.local');
    const cib = await prisma.ledgerAccount.findUniqueOrThrow({ where: { key: 'bank' } });
    const capital = await finance
      .post('/finance/capital')
      .send({
        direction: 'in',
        moneyAccountId: cib.id,
        amountPiastres: 5_000_000,
        reference: 'Owner',
        idempotencyKey: key(),
      })
      .expect(201);
    await admin
      .post(`/finance/requests/${capital.body.requestId}/decide`)
      .send({ approve: true })
      .expect(201);

    const staff = await prisma.user.findUniqueOrThrow({
      where: { email: 'staff.newcairo@shiplynow.local' },
    });
    // Only admin sets salaries.
    await finance
      .put(`/finance/salaries/${staff.id}`)
      .send({ monthlyPiastres: 500_000 })
      .expect(403);
    await admin.put(`/finance/salaries/${staff.id}`).send({ monthlyPiastres: 500_000 }).expect(200);
    const advance = await finance
      .post('/finance/advances')
      .send({
        userId: staff.id,
        amountPiastres: 50_000,
        moneyAccountId: cib.id,
        reference: 'Advance',
        idempotencyKey: key(),
      })
      .expect(201);
    expect(advance.body.status).toBe('posted');

    const month = addDays(cairoDay(new Date()), -35).slice(0, 7);
    const body = {
      month,
      moneyAccountId: cib.id,
      lines: [{ userId: staff.id, advanceRecoveryPiastres: 50_000 }],
    };
    const preview = await finance.post('/finance/payroll/preview').send(body).expect(201);
    expect(preview.body).toMatchObject({ totalNetPiastres: 450_000, totalCostPiastres: 500_000 });
    expect((await finance.post('/finance/payroll').send(body).expect(201)).body.status).toBe(
      'posted',
    );
    expect((await finance.post('/finance/payroll').send(body).expect(409)).body.error).toBe(
      'payroll_already_run',
    );

    const pay = await finance.get('/finance/staff-pay').expect(200);
    expect(pay.body.find((p: { userId: string }) => p.userId === staff.id)).toMatchObject({
      advanceOwedPiastres: 0,
    });
    const profit = await finance
      .get(
        `/finance/profit?by=store&from=${addDays(cairoDay(new Date()), -60)}&to=${cairoDay(new Date())}`,
      )
      .expect(200);
    expect(profit.body.rows.find((r: { id: string }) => r.id === staff.darkStoreId)).toMatchObject({
      costsPiastres: 500_000,
    });
    await finance.get('/finance/cost-per-order').expect(200);
  });
});
