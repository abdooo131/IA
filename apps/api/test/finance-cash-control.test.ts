import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { writeAccess } from '@shiplynow/db';
import { JOB_ROLE_TEMPLATES } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, FixedClock, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';
const NEW_CAIRO = { latitude: 30.03, longitude: 31.47 };
// Stores are open at Cairo noon; ledger entries keep the real time.
const NOON_CAIRO = new Date(`${new Date().toISOString().slice(0, 10)}T10:00:00Z`);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

describe('cash controls', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ncr: string;
  let maadi: string;
  const clock = new FixedClock(NOON_CAIRO);

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  type Agent = Awaited<ReturnType<typeof agent>>;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ clock }));
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    const seeded = await resetAndSeed(prisma);
    ncr = seeded.stores.get('NCR')!;
    maadi = seeded.stores.get('MAA')!;
  });

  /** A merchant COD order of 2 x EC-001 (680.00 EGP) packed at New Cairo. */
  async function packedOrder(staff: Agent) {
    const merchant = await agent('merchant@evechantelle.example');
    const sku = await prisma.sku.findFirstOrThrow({ where: { sku: 'EC-001' } });
    const created = await merchant
      .post('/merchant/orders')
      .send({
        customerName: 'Sara Ali',
        customerPhone: '01012345678',
        addressText: 'Villa 12, South 90th St',
        ...NEW_CAIRO,
        paymentMethod: 'cod',
        deliveryFeePiastres: 3000,
        items: [{ skuId: sku.id, quantity: 2 }],
      })
      .expect(201);
    const base = `/stores/${ncr}/orders/${created.body.id}`;
    await staff.post(`${base}/accept`).expect(201);
    await staff
      .post(`${base}/pick`)
      .send({ skuId: sku.id, quantity: 2, idempotencyKey: randomUUID() })
      .expect(201);
    const photo = await staff
      .post('/photos?kind=pack')
      .set('content-type', 'image/jpeg')
      .send(JPEG)
      .expect(201);
    await staff.post(`${base}/pack`).send({ photoId: photo.body.id }).expect(201);
    return { base, id: created.body.id as string };
  }

  async function deliver(staff: Agent) {
    const { base, id } = await packedOrder(staff);
    await staff.post(`${base}/handover`).send({ badgeCode: 'RDR-0001' }).expect(201);
    const order = await prisma.order.findUniqueOrThrow({ where: { id } });
    const rider = await agent('rider.newcairo@shiplynow.local');
    const deliveries = await rider.get('/rider/deliveries').expect(200);
    await rider
      .post(`/rider/deliveries/${deliveries.body[0].id}/complete`)
      .send({ otp: order.deliveryOtp, codCollectedPiastres: order.codAmountPiastres })
      .expect(201);
    return order;
  }

  const setting = (admin: Agent, key: string, value: number, scope = 'global') =>
    admin.put('/admin/settings').send({ key, value, scope }).expect(200);

  it('refuses a cash order past the rider limit unless a store manager overrides it', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const staff = await agent('staff.newcairo@shiplynow.local');
    await setting(admin, 'finance.rider_cash_limit_piastres', 100_000, ncr);
    await deliver(staff); // the rider now holds 680.00 EGP

    const { base } = await packedOrder(staff);
    const refused = await staff
      .post(`${base}/handover`)
      .send({ badgeCode: 'RDR-0001' })
      .expect(409);
    expect(refused.body).toMatchObject({
      error: 'rider_cash_limit',
      limitPiastres: 100_000,
      cashPiastres: 68_000,
      totalPiastres: 136_000,
    });
    // Store staff (store use) cannot override; a store manager (store manage) can.
    const noRight = await staff
      .post(`${base}/handover`)
      .send({ badgeCode: 'RDR-0001', cashOverrideReason: 'Rider goes to the bank next' })
      .expect(403);
    expect(noRight.body.error).toBe('no_access');
    await admin
      .post(`${base}/handover`)
      .send({ badgeCode: 'RDR-0001', cashOverrideReason: 'Rider goes to the bank next' })
      .expect(201);
    expect(await prisma.auditLog.count({ where: { action: 'order.rider_cash_override' } })).toBe(1);

    // The store screens show what the rider holds and since when.
    const cash = await staff.get(`/stores/${ncr}/cash`).expect(200);
    expect(cash.body).toMatchObject({ maxHours: 12, limitPiastres: 100_000 });
    const row = cash.body.riders.find((r: { badgeCode: string }) => r.badgeCode === 'RDR-0001');
    expect(row).toMatchObject({ cashPiastres: 68_000, overdue: false });
    expect(row.heldSince).toBeTruthy();
  });

  it('lets store staff pay petty cash with a receipt, and finance approve or reverse it', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const staff = await agent('staff.newcairo@shiplynow.local');
    const finance = await agent('finance@shiplynow.local');
    const order = await deliver(staff);
    const rider = await prisma.rider.findFirstOrThrow({ where: { badgeCode: 'RDR-0001' } });
    await staff
      .post(`/stores/${ncr}/cash/handovers`)
      .send({
        riderId: rider.id,
        countedPiastres: order.codAmountPiastres,
        idempotencyKey: randomUUID(),
      })
      .expect(201);
    await setting(admin, 'finance.petty_cash_float_piastres', 0, ncr);
    const packaging = await prisma.ledgerAccount.findUniqueOrThrow({
      where: { key: 'expense:packaging' },
    });

    // Staff see only categories finance opened for petty cash.
    expect((await staff.get(`/stores/${ncr}/petty-cash`).expect(200)).body.categories).toEqual([]);
    await staff
      .post(`/finance/petty-cash/categories/${packaging.id}`)
      .send({ petty: true })
      .expect(403);
    await finance
      .post(`/finance/petty-cash/categories/${packaging.id}`)
      .send({ petty: true })
      .expect(201);
    const screen = await staff.get(`/stores/${ncr}/petty-cash`).expect(200);
    expect(screen.body).toMatchObject({
      boxPiastres: 68_000,
      limitPiastres: 50_000,
      floatPiastres: 0,
      categories: [expect.objectContaining({ id: packaging.id })],
    });

    // Store staff upload the receipt themselves.
    const photo = async () =>
      (
        await staff
          .post('/photos?kind=receipt')
          .set('content-type', 'image/jpeg')
          .send(JPEG)
          .expect(201)
      ).body.id as string;
    const pay = async (amount: number) => {
      const photoId = await photo();
      return staff
        .post(`/stores/${ncr}/petty-cash`)
        .send({
          expenseAccountId: packaging.id,
          amountPiastres: amount,
          note: 'Tape and boxes',
          photoId,
          idempotencyKey: randomUUID(),
        })
        .expect(201);
    };
    expect((await pay(10_000)).body).toMatchObject({ status: 'posted', label: 'PC-000001' });
    const big = await pay(55_000);
    expect(big.body).toMatchObject({ status: 'pending', label: 'PC-000002' });
    const shelvesPhoto = await photo();
    const tooMuch = await staff
      .post(`/stores/${ncr}/petty-cash`)
      .send({
        expenseAccountId: packaging.id,
        amountPiastres: 60_000,
        note: 'Shelves',
        photoId: shelvesPhoto,
        idempotencyKey: randomUUID(),
      })
      .expect(409);
    expect(tooMuch.body).toMatchObject({ error: 'not_enough_cash_in_box', boxPiastres: 58_000 });

    // Staff never reach finance screens; finance approves (a second person).
    await staff.get('/finance/petty-cash').expect(403);
    const waiting = await prisma.financeRequest.findFirstOrThrow({ where: { kind: 'petty_cash' } });
    await finance
      .post(`/finance/requests/${waiting.id}/decide`)
      .send({ approve: true })
      .expect(201);
    const list = await finance.get(`/finance/petty-cash?darkStoreId=${ncr}`).expect(200);
    expect(
      list.body.map((r: { label: string; status: string }) => `${r.label}:${r.status}`),
    ).toEqual(['PC-000002:posted', 'PC-000001:posted']);

    // Someone limited to Maadi sees none of it and cannot reverse it.
    const limited = await createUser(prisma, {
      email: 'maadi.finance@t.eg',
      password: 'finance-pass-1',
      role: 'finance',
    });
    await prisma.$transaction((tx) =>
      writeAccess(
        tx,
        limited.id,
        { ...JOB_ROLE_TEMPLATES.finance_manager, allStores: false, jobRole: 'custom' },
        [maadi],
      ),
    );
    const maadiFinance = await agent('maadi.finance@t.eg', 'finance-pass-1');
    expect((await maadiFinance.get('/finance/petty-cash').expect(200)).body).toEqual([]);
    const id = list.body[1].id as string;
    expect(
      (
        await maadiFinance
          .post(`/finance/petty-cash/${id}/reverse`)
          .send({ reason: 'Not ours to keep' })
          .expect(403)
      ).body.error,
    ).toBe('store_not_allowed');

    // Reversing needs the approve level and a reason.
    const officer = await prisma.user.findUniqueOrThrow({
      where: { email: 'finance@shiplynow.local' },
    });
    await admin
      .put(`/admin/users/${officer.id}/access`)
      .send({ jobRole: 'finance_officer' })
      .expect(200);
    await finance
      .post(`/finance/petty-cash/${id}/reverse`)
      .send({ reason: 'Bought twice' })
      .expect(403);
    await admin.post(`/finance/petty-cash/${id}/reverse`).send({ reason: 'x' }).expect(400);
    await admin
      .post(`/finance/petty-cash/${id}/reverse`)
      .send({ reason: 'Bought twice by mistake' })
      .expect(201);
    const after = await staff.get(`/stores/${ncr}/petty-cash`).expect(200);
    expect(after.body.boxPiastres).toBe(68_000 - 55_000);
  });

  it('shows the cash position with its CSV and the month end checklist', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const staff = await agent('staff.newcairo@shiplynow.local');
    await deliver(staff);
    const position = await admin.get('/finance/cash-position').expect(200);
    expect(position.body.scope).toBe('all');
    expect(position.body.riders.totalPiastres).toBe(68_000);
    expect(position.body.riders.rows[0]).toMatchObject({
      badgeCode: 'RDR-0001',
      freshPiastres: 68_000,
    });
    expect(position.body.merchants.rows[0]).toMatchObject({ nextPayoutDay: expect.any(String) });
    expect(typeof position.body.netPiastres).toBe('number');
    const file = await admin.get('/finance/cash-position/export.csv').expect(200);
    expect(file.headers['content-type']).toContain('text/csv');
    expect(file.text.charCodeAt(0)).toBe(0xfeff);
    expect(file.text).toContain('rider_cash');
    expect(file.text).toContain('net_position');
    await staff.get('/finance/cash-position').expect(403);

    // Month end: last month by default.
    const list = await admin.get('/finance/month-end').expect(200);
    expect(list.body.items.map((i: { id: string }) => i.id)).toContain('vat_return');
    await admin
      .post(`/finance/month-end/${list.body.month}/marks`)
      .send({ item: 'books_closed', note: 'no' })
      .expect(400);
    await admin
      .post(`/finance/month-end/${list.body.month}/marks`)
      .send({ item: 'vat_return', note: 'Filed on the ETA portal' })
      .expect(201);
    const marked = await admin.get(`/finance/month-end?month=${list.body.month}`).expect(200);
    expect(marked.body.items.find((i: { id: string }) => i.id === 'vat_return')).toMatchObject({
      done: true,
      mark: { note: 'Filed on the ETA portal' },
    });
    await admin.get('/finance/month-end?month=2026-13').expect(400);

    // An accountant (accounting view) reads but does not tick.
    const viewer = await prisma.user.findUniqueOrThrow({
      where: { email: 'finance@shiplynow.local' },
    });
    await admin.put(`/admin/users/${viewer.id}/access`).send({ jobRole: 'accountant' }).expect(200);
    const accountant = await agent('finance@shiplynow.local');
    await accountant.get('/finance/month-end').expect(200);
    await accountant.delete(`/finance/month-end/${list.body.month}/marks/vat_return`).expect(403);
    await admin.delete(`/finance/month-end/${list.body.month}/marks/vat_return`).expect(200);
  });
});
