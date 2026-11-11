import type { INestApplication } from '@nestjs/common';
import { changeSetting, post } from '@shiplynow/db';
import { addDays, cairoDay, depositDeadline } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JobsService } from '../src/jobs/jobs.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, grantAccess, resetAndSeed } from './helpers';

// Basata cash deposits (owner, 2026-11-11): the rider sends a deposit from the rider app,
// Accounting reviews it, records Basata's transfer and unfreezes riders; nobody else does.

const DEMO = 'demo-password-1';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
const RIDER = 'rider.newcairo@shiplynow.local';

describe('Basata deposits', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ncr: string;
  let riderId: string;
  let adminId: string;
  let n = 0;

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const collect = (amount: number, when = new Date(Date.now() - 3600_000)) =>
    post(prisma, {
      kind: 'cod_collected',
      idempotencyKey: `test:cod:${++n}`,
      occurredAt: when,
      lines: [
        { account: { type: 'rider_cash', riderId }, amount },
        { account: { type: 'cash_difference' }, amount: -amount },
      ],
    });
  type Agent = Awaited<ReturnType<typeof agent>>;
  const send = async (rider: Agent, amount: number, reference: string) => {
    const photo = await rider
      .post('/photos?kind=basata_receipt')
      .set('content-type', 'image/jpeg')
      .send(JPEG)
      .expect(201);
    return rider.post('/rider/basata/deposits').send({
      amountPiastres: amount,
      reference,
      photoId: photo.body.id,
      idempotencyKey: `basata-${reference}-key`,
    });
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    const seeded = await resetAndSeed(prisma);
    ncr = seeded.stores.get('NCR')!;
    riderId = (await prisma.rider.findFirstOrThrow({ where: { user: { email: RIDER } } })).id;
    adminId = (await prisma.user.findFirstOrThrow({ where: { role: 'admin' } })).id;
  });

  it('takes a rider’s deposit and lets Accounting approve it; others are kept out', async () => {
    await collect(50_000);
    const rider = await agent(RIDER);
    const screen = await rider.get('/rider/basata').expect(200);
    expect(screen.body).toMatchObject({ enabled: true, maxPiastres: 50_000, frozen: null });

    const sent = await send(rider, 30_000, 'BS-1001');
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ number: 'BD-000001', status: 'pending' });
    await send(rider, 30_000, 'BS1001').then((r) => expect(r.status).toBe(409));
    await send(rider, 30_000, 'BS-2002').then((r) =>
      expect(r.body).toMatchObject({ error: 'more_than_cash' }),
    );
    // A rider never reaches Accounting.
    await rider.get('/lists/accounting/basata_deposits').expect(403);
    await rider.post(`/finance/basata/deposits/${sent.body.id}/approve`).expect(403);

    // Store staff without accounting see nothing either.
    const staff = await agent('staff.newcairo@shiplynow.local');
    await staff.get('/lists/accounting/basata_deposits').expect(403);
    await staff.post(`/finance/basata/deposits/${sent.body.id}/approve`).expect(403);

    const finance = await agent('finance@shiplynow.local');
    const list = await finance.get('/lists/accounting/basata_deposits').expect(200);
    expect(list.body.rows.map((r: { id: string }) => r.id)).toEqual([sent.body.id]);
    expect(list.body.totals.amount).toBe(30_000);
    const options = await finance.get('/lists/accounting/basata_deposits/options').expect(200);
    expect(options.body.rider.map((o: { value: string }) => o.value)).toContain(riderId);
    const doc = await finance.get(`/finance/documents/basata_deposit/${sent.body.id}`).expect(200);
    expect(doc.body).toMatchObject({ number: 'BD-000001', actions: ['approve', 'reject'] });
    await finance
      .post(`/finance/basata/deposits/${sent.body.id}/reject`)
      .send({ reason: 'no' })
      .expect(400);
    const bulk = await finance
      .post('/finance/basata/deposits/bulk-approve')
      .send({ ids: [sent.body.id] })
      .expect(201);
    expect(bulk.body.results).toEqual([{ id: sent.body.id, ok: true }]);
    const mine = await rider.get('/rider/basata').expect(200);
    expect(mine.body.deposits[0]).toMatchObject({ status: 'approved' });
    expect(mine.body.maxPiastres).toBe(20_000);

    // Basata's transfer: 299 EGP arrived for 300 EGP of deposits.
    const form = await finance.get('/finance/basata/settlements/new').expect(200);
    expect(form.body.totalPiastres).toBe(30_000);
    const settled = await finance
      .post('/finance/basata/settlements')
      .send({
        receivedOn: cairoDay(new Date()),
        amountPiastres: 29_900,
        depositIds: [sent.body.id],
        idempotencyKey: 'basata-settlement-1',
      })
      .expect(201);
    expect(settled.body).toMatchObject({ number: 'BT-000001', feePiastres: 100 });
    await staff
      .post('/finance/basata/settlements')
      .send({
        receivedOn: cairoDay(new Date()),
        amountPiastres: 1,
        depositIds: [sent.body.id],
        idempotencyKey: 'basata-settlement-2',
      })
      .expect(403);
  });

  it('refuses a deposit or a handover while its channel is closed', async () => {
    await collect(10_000);
    await changeSetting(prisma, {
      key: 'cash.basata_enabled',
      scope: ncr,
      value: 0,
      actorUserId: adminId,
    });
    const rider = await agent(RIDER);
    expect((await rider.get('/rider/me').expect(200)).body.basataEnabled).toBe(false);
    await send(rider, 5000, 'BS-3003').then((r) =>
      expect(r.body).toMatchObject({ error: 'basata_closed' }),
    );
    await changeSetting(prisma, {
      key: 'cash.store_handover_enabled',
      scope: ncr,
      value: 0,
      actorUserId: adminId,
    });
    const staff = await agent('staff.newcairo@shiplynow.local');
    expect((await staff.get(`/stores/${ncr}/cash`).expect(200)).body.handoverEnabled).toBe(false);
    await staff
      .post(`/stores/${ncr}/cash/handovers`)
      .send({ riderId, countedPiastres: 10_000, idempotencyKey: 'handover-closed-1' })
      .expect(409, { error: 'store_handover_closed' });
  });

  it('freezes at the deadline; only Accounting unfreezes, with a reason', async () => {
    const day = addDays(cairoDay(new Date()), -2);
    const deadline = depositDeadline(day, 23);
    await collect(15_000, new Date(deadline.getTime() - 3 * 3600_000));
    // The rule started the day before (the first run only marks the start).
    await prisma.cashDeadlineRun.create({
      data: {
        day: new Date(`${addDays(day, -1)}T00:00:00Z`),
        deadlineAt: depositDeadline(addDays(day, -1), 23),
        skipped: true,
      },
    });
    const result = await app
      .get(JobsService)
      .runDepositDeadline(new Date(deadline.getTime() + 60_000));
    expect(result).toMatchObject({ days: [day], frozen: 1, chargedPiastres: 15_000 });

    const rider = await agent(RIDER);
    const me = await rider.get('/rider/me').expect(200);
    expect(me.body.frozen).toMatchObject({ reason: 'deposit_deadline' });
    await rider
      .post('/rider/withdrawals')
      .send({
        amountPiastres: 1000,
        details: { method: 'instapay', handle: 'rider1@instapay' },
        idempotencyKey: 'frozen-withdrawal-1',
      })
      .expect(409, { error: 'rider_frozen' });

    // A store manager may not unfreeze.
    const staff = await prisma.user.findFirstOrThrow({
      where: { email: 'staff.newcairo@shiplynow.local' },
    });
    await grantAccess(prisma, staff.id, 'store_manager', [ncr]);
    const manager = await agent('staff.newcairo@shiplynow.local');
    expect((await manager.get(`/stores/${ncr}/cash`).expect(200)).body.riders).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: riderId, frozen: true })]),
    );
    await manager
      .post(`/finance/frozen-riders/${riderId}/unfreeze`)
      .send({ reason: 'He paid me in cash' })
      .expect(403);

    const finance = await agent('finance@shiplynow.local');
    const frozen = await finance.get('/finance/frozen-riders').expect(200);
    expect(frozen.body).toEqual([
      expect.objectContaining({ riderId, deductedPiastres: 15_000, reason: 'deposit_deadline' }),
    ]);
    await finance
      .post(`/finance/frozen-riders/${riderId}/unfreeze`)
      .send({ reason: 'ok' })
      .expect(400);
    await finance
      .post(`/finance/frozen-riders/${riderId}/unfreeze`)
      .send({ reason: 'Paid the office back in full' })
      .expect(201);
    const state = await finance.get(`/finance/frozen-riders/${riderId}`).expect(200);
    expect(state.body.frozen).toBe(false);
    expect(state.body.history[0]).toMatchObject({ unfreezeReason: 'Paid the office back in full' });
    expect((await rider.get('/rider/me').expect(200)).body.frozen).toBeNull();
  });
});
