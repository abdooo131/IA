import type { INestApplication } from '@nestjs/common';
import { addDays, cairoDay } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetAndSeed } from './helpers';

let n = 0;
const key = () => `fc-${++n}-${Date.now()}`;

describe('cheques, merchant contracts and profitability end to end', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const agent = async (email: string, password = 'demo-password-1') => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const merchantId = async () =>
    (await prisma.merchant.findFirstOrThrow({ where: { name: { contains: 'Eve' } } })).id;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetAndSeed(prisma);
  });

  it('registers a cheque from a merchant, approved by a second person, and bounces it', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const finance = await agent('finance@shiplynow.local');
    const mid = await merchantId();
    const today = cairoDay(new Date());
    const created = await finance
      .post('/finance/cheques')
      .send({
        direction: 'received',
        purpose: 'merchant',
        chequeNumber: '445566',
        bankName: 'QNB',
        amountPiastres: 120_000,
        issueDate: today,
        dueDate: addDays(today, 2),
        merchantId: mid,
        idempotencyKey: key(),
      })
      .expect(201);
    expect(created.body).toMatchObject({ status: 'pending', chequeStatus: 'awaiting_approval' });
    // A wrong pairing of purpose and direction is refused before anything is written.
    await finance
      .post('/finance/cheques')
      .send({
        direction: 'issued',
        purpose: 'merchant',
        chequeNumber: '1',
        amountPiastres: 1,
        issueDate: today,
        dueDate: today,
        idempotencyKey: key(),
      })
      .expect(400);
    const requests = await finance.get('/finance/requests?status=pending').expect(200);
    expect(requests.body[0]).toMatchObject({ kind: 'cheque_in', amountPiastres: 120_000 });
    await finance
      .post(`/finance/requests/${created.body.requestId}/decide`)
      .send({ approve: true })
      .expect(403);
    await admin
      .post(`/finance/requests/${created.body.requestId}/decide`)
      .send({ approve: true })
      .expect(201);

    const detail = await finance.get(`/finance/cheques/${created.body.id}`).expect(200);
    expect(detail.body).toMatchObject({ status: 'received', label: 'CHQ-000001' });
    expect(detail.body.bookEntry.number).toMatch(/^JV-/);
    const due = await finance.get('/finance/cheques-due').expect(200);
    expect(due.body.thisWeek).toHaveLength(1);
    expect(
      (await finance.get('/finance/cheques?direction=received').expect(200)).body,
    ).toHaveLength(1);
    expect(
      (await finance.post(`/finance/cheques/${created.body.id}/clear`).send({}).expect(409)).body
        .error,
    ).toBe('cheque_not_due');
    await finance
      .post(`/finance/cheques/${created.body.id}/bounce`)
      .send({ reason: 'Account closed' })
      .expect(201);
    const alerts = await admin.get('/admin/alerts').expect(200);
    expect(alerts.body.some((a: { type: string }) => a.type === 'cheque_bounced')).toBe(true);
    const history = await finance.get(`/history/cheque/${created.body.id}`).expect(200);
    expect(history.body.map((h: { action: string }) => h.action)).toEqual(
      expect.arrayContaining([
        'finance.cheque_register',
        'finance.cheque_book',
        'finance.cheque_bounce',
      ]),
    );
  });

  it('edits the contract in Merchants, shows it read only to the merchant, enforces the credit limit', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const finance = await agent('finance@shiplynow.local');
    const merchant = await agent('merchant@evechantelle.example');
    const mid = await merchantId();
    const today = cairoDay(new Date());
    const body = {
      orderFixedPiastres: null,
      orderPercentBp: null,
      codPercentBp: null,
      failedDeliveryPiastres: null,
      receivingPerUnitPiastres: null,
      storagePerUnitMonthPiastres: null,
      returnPerUnitPiastres: null,
      payoutSchedule: null,
      minimumPayoutPiastres: null,
      promiseMinutes: null,
      deliveryAttempts: null,
      startDate: addDays(today, -10),
      endDate: addDays(today, 355),
      noticeDays: 60,
      minimumMonthlyFeePiastres: 500_000,
      securityDepositPiastres: 1_000_000,
      creditLimitPiastres: 0,
      internalNote: 'Signed by the owner',
      tiers: [
        { fromOrder: 1, fixedFeePiastres: 2_500 },
        { fromOrder: 101, fixedFeePiastres: 2_000, percentBp: 50 },
      ],
    };
    // Accounting reads contracts; only merchants manage writes and activates versions.
    await finance.post(`/admin/merchants/${mid}/contract/versions`).send(body).expect(403);
    await admin
      .post(`/admin/merchants/${mid}/contract/versions`)
      .send({ ...body, tiers: [...body.tiers, { fromOrder: 1, fixedFeePiastres: 1 }] })
      .expect(400);
    const draft = await admin
      .post(`/admin/merchants/${mid}/contract/versions`)
      .send({ ...body, idempotencyKey: key() })
      .expect(201);
    await finance
      .post(`/admin/merchants/${mid}/contract/versions/${draft.body.id}/activate`)
      .send({ effectiveFrom: today })
      .expect(403);
    const saved = await admin
      .post(`/admin/merchants/${mid}/contract/versions/${draft.body.id}/activate`)
      .send({ effectiveFrom: today })
      .expect(201);
    expect(saved.body.current).toMatchObject({
      noticeDays: 60,
      noticeBy: addDays(today, 295),
      effectiveFrom: today,
    });
    expect(
      (await finance.get(`/admin/merchants/${mid}/contract`).expect(200)).body.current.tiers,
    ).toHaveLength(2);
    const listed = await finance.get('/finance/contracts').expect(200);
    expect(
      listed.body.find((r: { merchant: { id: string } }) => r.merchant.id === mid),
    ).toMatchObject({
      creditLimitPiastres: 0,
      depositHeldPiastres: 0,
    });
    const mine = await merchant.get('/merchant/contract').expect(200);
    expect(mine.body.current).toMatchObject({
      minimumMonthlyFeePiastres: 500_000,
      internalNote: null,
    });

    const deposit = await finance
      .post(`/finance/merchants/${mid}/deposit`)
      .send({
        direction: 'in',
        via: 'bank',
        amountPiastres: 1_000_000,
        reference: 'Deposit transfer',
        idempotencyKey: key(),
      })
      .expect(201);
    expect(deposit.body.status).toBe('pending');

    // The merchant owes us a piastre more than the limit of zero: shipments stop.
    await finance
      .post('/finance/adjustments')
      .send({
        merchantId: mid,
        amountPiastres: -1,
        reason: 'Fee owed by the merchant',
        idempotencyKey: key(),
      })
      .then(async (r) => {
        if (r.body.requestId)
          await admin.post(`/finance/requests/${r.body.requestId}/decide`).send({ approve: true });
      });
    const sku = await prisma.sku.findFirstOrThrow({ where: { merchantId: mid } });
    const store = await prisma.darkStore.findFirstOrThrow({ where: { code: 'NCR' } });
    const refused = await merchant
      .post('/merchant/manifests')
      .send({
        darkStoreId: store.id,
        reference: 'PO-9',
        lines: [{ skuId: sku.id, expectedQty: 1 }],
      })
      .expect(409);
    expect(refused.body.error).toBe('merchant_over_credit_limit');
    expect(await prisma.alert.count({ where: { type: 'merchant_over_credit_limit' } })).toBe(1);
  });

  it('answers merchant profitability for a month and refuses a bad month', async () => {
    const finance = await agent('finance@shiplynow.local');
    const mid = await merchantId();
    const month = cairoDay(new Date()).slice(0, 7);
    await finance.get('/finance/merchant-profit?month=2026-13').expect(400);
    const all = await finance.get(`/finance/merchant-profit?month=${month}`).expect(200);
    expect(all.body.month).toBe(month);
    const one = await finance.get(`/finance/merchant-profit/${mid}?month=${month}`).expect(200);
    expect(one.body).toMatchObject({ merchant: { id: mid }, base: { deliveredOrders: 0 } });
    expect(one.body.current).toHaveProperty('orderFixedPiastres');
    const staff = await agent('staff.newcairo@shiplynow.local');
    await staff.get(`/finance/merchant-profit?month=${month}`).expect(403);
  });
});
