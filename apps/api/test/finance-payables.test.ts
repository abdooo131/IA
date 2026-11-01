import type { INestApplication } from '@nestjs/common';
import { addDays, cairoDay } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';
let n = 0;
const key = () => `fp-${++n}-${Date.now()}`;

describe('suppliers, bills, taxes and assets end to end', () => {
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

  it('records a bill, pays it with withholding tax and pays the tax', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const finance = await agent('finance@shiplynow.local');
    const cib = await account('bank');
    const capital = await finance
      .post('/finance/capital')
      .send({
        direction: 'in',
        moneyAccountId: cib.id,
        amountPiastres: 2_000_000,
        reference: 'Owner',
        idempotencyKey: key(),
      })
      .expect(201);
    await admin
      .post(`/finance/requests/${capital.body.requestId}/decide`)
      .send({ approve: true })
      .expect(201);

    const supplier = await finance
      .post('/finance/suppliers')
      .send({
        name: 'Cairo Packaging Co',
        taxId: '200-300-400',
        whtBp: 100,
        defaultExpenseAccountId: (await account('expense:packaging')).id,
      })
      .expect(201);
    const today = cairoDay(new Date());
    const bill = await finance
      .post('/finance/bills')
      .send({
        supplierId: supplier.body.id,
        reference: 'CP-1',
        billDate: addDays(today, -10),
        dueDate: addDays(today, -3),
        netPiastres: 100_000,
        vatPiastres: 14_000,
        idempotencyKey: key(),
      })
      .expect(201);
    expect(bill.body.number).toBe('BILL-000001');
    const open = await finance.get('/finance/bills?status=open').expect(200);
    expect(open.body[0]).toMatchObject({ overdue: true, leftPiastres: 114_000 });
    const ageing = await finance.get('/finance/bills-ageing').expect(200);
    expect(ageing.body.total.buckets.d1_30).toBe(114_000);

    const paid = await finance
      .post(`/finance/bills/${bill.body.id}/payments`)
      .send({
        amountPiastres: 114_000,
        moneyAccountId: cib.id,
        reference: 'Transfer 9',
        idempotencyKey: key(),
      })
      .expect(201);
    expect(paid.body.status).toBe('posted');
    expect((await finance.get('/finance/taxes').expect(200)).body.whtPiastres).toBe(1_000);
    const report = await finance.get('/finance/taxes/withholding').expect(200);
    expect(report.body.rows[0]).toMatchObject({ taxId: '200-300-400', whtPiastres: 1_000 });
    const tax = await finance
      .post('/finance/taxes/payments')
      .send({
        tax: 'wht',
        amountPiastres: 1_000,
        moneyAccountId: cib.id,
        reference: 'Q form 41',
        idempotencyKey: key(),
      })
      .expect(201);
    expect(tax.body.status).toBe('posted');
    const suppliers = await finance.get('/finance/suppliers').expect(200);
    expect(suppliers.body[0]).toMatchObject({ owedPiastres: 0, openBills: 0 });
  });

  it('buys equipment, prepays rent, sets a recurring expense and asks a merchant to pay', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const finance = await agent('finance@shiplynow.local');
    const cib = await account('bank');
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
    const month = cairoDay(new Date()).slice(0, 7);
    const bad = await finance
      .post('/finance/assets')
      .send({
        name: 'Fridge',
        amountPiastres: 100_000,
        salvagePiastres: 100_000,
        lifeMonths: 24,
        startMonth: month,
        moneyAccountId: cib.id,
        reference: 'Shop',
        idempotencyKey: key(),
      })
      .expect(400);
    expect(JSON.stringify(bad.body)).toContain('invalid_salvage');
    await finance
      .post('/finance/assets')
      .send({
        name: 'Fridge',
        amountPiastres: 240_000,
        lifeMonths: 24,
        startMonth: month,
        moneyAccountId: cib.id,
        reference: 'Shop',
        idempotencyKey: key(),
      })
      .expect(201);
    expect((await finance.get('/finance/assets').expect(200)).body[0]).toMatchObject({
      monthlyPiastres: 10_000,
      bookValuePiastres: 240_000,
    });
    await finance
      .post('/finance/prepayments')
      .send({
        name: 'Rent ahead',
        expenseAccountId: (await account('expense:rent')).id,
        amountPiastres: 600_000,
        months: 6,
        startMonth: month,
        moneyAccountId: cib.id,
        reference: 'Lease',
        idempotencyKey: key(),
      })
      .expect(201);
    expect((await finance.get('/finance/prepayments').expect(200)).body).toHaveLength(1);
    await finance
      .post('/finance/recurring')
      .send({
        name: 'Internet',
        expenseAccountId: (await account('expense:utilities')).id,
        paidFromAccountId: cib.id,
        amountPiastres: 50_000,
        memo: 'Internet',
        reference: 'WE',
        dayOfMonth: 5,
        startMonth: month,
      })
      .expect(201);
    const list = await finance.get('/finance/recurring').expect(200);
    await finance
      .patch(`/finance/recurring/${list.body[0].id}`)
      .send({ isActive: false })
      .expect(200);

    // Nobody owes us yet: asking for payment is refused.
    const merchant = await prisma.merchant.findFirstOrThrow();
    const none = await finance
      .post(`/finance/receivables/${merchant.id}/request`)
      .send({})
      .expect(409);
    expect(none.body.error).toBe('nothing_owed');
    expect((await finance.get('/finance/receivables').expect(200)).body).toEqual([]);
  });
});
