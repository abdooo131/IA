import type { INestApplication } from '@nestjs/common';
import { post } from '@shiplynow/db';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, grantAccess, resetAndSeed } from './helpers';

// Rider pay (CLAUDE.md "Rider pay"): the rider sees only their own wallet and requests;
// Accounting approves and pays; a store manager pays cash at their store.

const DEMO = 'demo-password-1';

describe('rider wallet and withdrawals', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ncr: string;
  let riderId: string;
  let otherRiderId: string;

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };

  /** Earnings made 20 days ago (long past their hold), posted as deliveries post them. */
  const earn = (id: string, amount: number, key: string) =>
    post(prisma, {
      kind: 'rider_bonus',
      idempotencyKey: key,
      occurredAt: new Date(Date.now() - 20 * 86_400_000),
      lines: [
        { account: { type: 'rider_bonus_expense' }, amount },
        { account: { type: 'rider_bonus', riderId: id }, amount: -amount },
      ],
    });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    const seeded = await resetAndSeed(prisma);
    ncr = seeded.stores.get('NCR')!;
    riderId = (
      await prisma.rider.findFirstOrThrow({
        where: { user: { email: 'rider.newcairo@shiplynow.local' } },
      })
    ).id;
    otherRiderId = (
      await prisma.rider.findFirstOrThrow({
        where: { user: { email: 'rider.maadi@shiplynow.local' } },
      })
    ).id;
    await earn(riderId, 50_000, 'test:earn:1');
    await earn(otherRiderId, 20_000, 'test:earn:2');
  });

  it('shows the rider only their own wallet, and takes a request once per key', async () => {
    const rider = await agent('rider.newcairo@shiplynow.local');
    const wallet = await rider.get('/rider/wallet').expect(200);
    expect(wallet.body.totals).toMatchObject({
      availablePiastres: 50_000,
      onHoldPiastres: 0,
      earnedAllPiastres: 50_000,
    });
    expect(wallet.body.rider.id).toBe(riderId);

    const body = {
      amountPiastres: 30_000,
      details: { method: 'mobile_wallet', provider: 'vodafone_cash', phone: '01012345678' },
      idempotencyKey: 'rw-api-1-key',
    };
    const first = await rider.post('/rider/withdrawals').send(body).expect(201);
    const again = await rider.post('/rider/withdrawals').send(body).expect(201);
    expect(again.body.id).toBe(first.body.id);
    expect(first.body).toMatchObject({ number: 'RW-000001', status: 'requested' });
    await rider
      .post('/rider/withdrawals')
      .send({ ...body, idempotencyKey: 'rw-api-2-key' })
      .expect(409, { error: 'withdrawal_already_open' });
    await rider
      .post('/rider/withdrawals')
      .send({
        ...body,
        details: { method: 'bank', bankName: 'CIB', iban: 'EG1', holder: 'Ali' },
        idempotencyKey: 'rw-api-3-key',
      })
      .expect(400);

    // Another rider sees nothing of it and cannot cancel it.
    const other = await agent('rider.maadi@shiplynow.local');
    const theirs = await other.get('/rider/wallet').expect(200);
    expect(theirs.body.withdrawals).toHaveLength(0);
    expect(theirs.body.totals.availablePiastres).toBe(20_000);
    await other.post(`/rider/withdrawals/${first.body.id}/cancel`).expect(404);
    // Riders never reach Accounting's list.
    await rider.get('/finance/rider-withdrawals').expect(403);
    await rider.post(`/rider/withdrawals/${first.body.id}/cancel`).expect(201);
  });

  it('lets Accounting approve and pay, and keeps store staff out', async () => {
    const rider = await agent('rider.newcairo@shiplynow.local');
    const w = await rider
      .post('/rider/withdrawals')
      .send({
        amountPiastres: 20_000,
        details: { method: 'instapay', handle: 'rider1@instapay' },
        idempotencyKey: 'rw-api-4-key',
      })
      .expect(201);
    const staff = await agent('staff.newcairo@shiplynow.local');
    await staff.get('/finance/rider-withdrawals').expect(403);
    await staff.post(`/finance/rider-withdrawals/${w.body.id}/approve`).expect(403);

    const finance = await agent('finance@shiplynow.local');
    const list = await finance.get('/finance/rider-withdrawals?status=requested').expect(200);
    expect(list.body.withdrawals.map((x: { id: string }) => x.id)).toEqual([w.body.id]);
    await finance.post(`/finance/rider-withdrawals/${w.body.id}/approve`).expect(201);
    // Fund the bank, then pay.
    await post(prisma, {
      kind: 'capital_in',
      idempotencyKey: 'test:capital',
      lines: [
        { account: { type: 'bank' }, amount: 1_000_000 },
        { account: { type: 'revenue' }, amount: -1_000_000 },
      ],
    });
    const paid = await finance
      .post(`/finance/rider-withdrawals/${w.body.id}/pay`)
      .send({ reference: 'IPN-778' })
      .expect(201);
    expect(paid.body).toMatchObject({ status: 'paid', reference: 'IPN-778' });
    const wallets = await finance.get('/finance/rider-wallets').expect(200);
    expect(
      wallets.body.find((r: { id: string }) => r.id === riderId).wallet.availablePiastres,
    ).toBe(30_000);
    const after = await rider.get('/rider/wallet').expect(200);
    expect(after.body.withdrawals[0]).toMatchObject({ status: 'paid' });
  });

  it('lets the store manager pay an approved cash withdrawal from the store box', async () => {
    const rider = await agent('rider.newcairo@shiplynow.local');
    const w = await rider
      .post('/rider/withdrawals')
      .send({
        amountPiastres: 10_000,
        details: { method: 'store_cash' },
        idempotencyKey: 'rw-api-5-key',
      })
      .expect(201);
    const staff = await prisma.user.findUniqueOrThrow({
      where: { email: 'staff.newcairo@shiplynow.local' },
    });
    const clerk = await agent('staff.newcairo@shiplynow.local');
    // Store use is not enough.
    await clerk.get(`/stores/${ncr}/cash/withdrawals`).expect(403);
    await grantAccess(prisma, staff.id, 'store_manager', [ncr]);
    const manager = await agent('staff.newcairo@shiplynow.local');
    // Not approved yet: nothing to pay.
    await manager
      .post(`/stores/${ncr}/cash/withdrawals/${w.body.id}/pay`)
      .send({ reference: 'cash' })
      .expect(409, { error: 'withdrawal_not_approved' });
    const finance = await agent('finance@shiplynow.local');
    await finance.post(`/finance/rider-withdrawals/${w.body.id}/approve`).expect(201);
    // The box is empty until riders hand in cash.
    await manager
      .post(`/stores/${ncr}/cash/withdrawals/${w.body.id}/pay`)
      .send({ reference: 'cash' })
      .expect(409, { error: 'not_enough_money' });
    await post(prisma, {
      kind: 'test_cash',
      idempotencyKey: 'test:box',
      lines: [
        { account: { type: 'store_cash', darkStoreId: ncr }, amount: 50_000 },
        { account: { type: 'revenue' }, amount: -50_000 },
      ],
    });
    const listed = await manager.get(`/stores/${ncr}/cash/withdrawals`).expect(200);
    expect(listed.body.map((x: { id: string }) => x.id)).toEqual([w.body.id]);
    await manager
      .post(`/stores/${ncr}/cash/withdrawals/${w.body.id}/pay`)
      .send({ reference: 'Cash at NCR' })
      .expect(201);
    const row = await prisma.riderWithdrawal.findUniqueOrThrow({ where: { id: w.body.id } });
    expect(row.status).toBe('paid');
  });

  it('lets HR switch a rider between per delivery and a salary', async () => {
    const file = await prisma.employee.findFirstOrThrow({
      where: { user: { email: 'rider.newcairo@shiplynow.local' } },
    });
    expect(file.payBasis).toBe('per_delivery');
    const admin = await agent('admin@test.eg', 'admin-password-1');
    await admin
      .put(`/hr/employees/${file.id}/pay-basis`)
      .send({ payBasis: 'monthly_salary' })
      .expect(200);
    const staffFile = await prisma.employee.findFirstOrThrow({
      where: { user: { email: 'staff.newcairo@shiplynow.local' } },
    });
    await admin
      .put(`/hr/employees/${staffFile.id}/pay-basis`)
      .send({ payBasis: 'per_delivery' })
      .expect(400, { error: 'per_delivery_riders_only' });
  });
});
