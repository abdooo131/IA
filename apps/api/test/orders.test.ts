import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { cairoDay } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JobsService } from '../src/jobs/jobs.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, FixedClock, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';
const NOON_CAIRO = new Date('2026-01-14T10:00:00Z');
const NEW_CAIRO = { latitude: 30.03, longitude: 31.47 };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

describe('orders end to end', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ncr: string;
  const clock = new FixedClock(NOON_CAIRO);

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const sku = (code: string) => prisma.sku.findFirstOrThrow({ where: { sku: code } });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ clock }));
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    clock.set(NOON_CAIRO);
    const seeded = await resetAndSeed(prisma);
    ncr = seeded.stores.get('NCR')!;
  });

  const orderBody = async (extra: Record<string, unknown> = {}) => ({
    customerName: 'Sara Ali',
    customerPhone: '0101 234 5678',
    addressText: 'Villa 12, South 90th St',
    ...NEW_CAIRO,
    paymentMethod: 'cod',
    deliveryFeePiastres: 3000,
    items: [
      { skuId: (await sku('EC-001')).id, quantity: 2 },
      { skuId: (await sku('EC-019')).id, quantity: 1 },
    ],
    ...extra,
  });

  it('runs an order from the merchant to the customer', async () => {
    const merchant = await agent('merchant@evechantelle.example');
    const created = await merchant
      .post('/merchant/orders')
      .send(await orderBody())
      .expect(201);
    expect(created.body).toMatchObject({ status: 'new', phoneFlagged: false, cancelled: [] });

    const staff = await agent('staff.newcairo@shiplynow.local');
    const queue = await staff.get(`/stores/${ncr}/orders`).expect(200);
    expect(queue.body[0]).toMatchObject({
      number: created.body.number,
      stage: { stage: 'accept' },
    });

    const base = `/stores/${ncr}/orders/${created.body.id}`;
    await staff.post(`${base}/accept`).expect(201);
    const detail = await staff.get(base).expect(200);
    for (const item of detail.body.items) {
      await staff
        .post(`${base}/pick`)
        .send({ skuId: item.skuId, quantity: item.quantity, idempotencyKey: randomUUID() })
        .expect(201);
    }
    const photo = await staff
      .post('/photos?kind=pack')
      .set('content-type', 'image/jpeg')
      .send(JPEG)
      .expect(201);
    await staff.post(`${base}/pack`).send({ photoId: photo.body.id }).expect(201);
    const handed = await staff.post(`${base}/handover`).send({ badgeCode: 'RDR-0001' }).expect(201);
    expect(handed.body).toMatchObject({ rider: 'Ahmed Samir', batched: false });

    const admin = await agent('admin@test.eg', 'admin-password-1');
    const adminView = await admin.get(`/admin/orders/${created.body.id}`).expect(200);
    expect(adminView.body.deliveryOtp).toMatch(/^\d{4}$/);
    const merchantView = await merchant.get(`/merchant/orders/${created.body.id}`).expect(200);
    expect(merchantView.body.deliveryOtp).toBeUndefined();
    expect(merchantView.body.status).toBe('out_for_delivery');

    const rider = await agent('rider.newcairo@shiplynow.local');
    const deliveries = await rider.get('/rider/deliveries').expect(200);
    expect(deliveries.body[0]).toMatchObject({
      status: 'picked_up',
      order: { number: created.body.number, units: 3 },
    });
    const expected = deliveries.body[0].codExpectedPiastres;
    expect(expected).toBe(2 * 32500 + 9900 + 3000);
    await rider
      .post(`/rider/deliveries/${deliveries.body[0].id}/complete`)
      .send({ otp: adminView.body.deliveryOtp, codCollectedPiastres: expected })
      .expect(201);
    const me = await rider.get('/rider/me').expect(200);
    expect(me.body.today).toEqual({ delivered: 1, failed: 0, codCollectedPiastres: expected });

    const done = await merchant.get(`/merchant/orders/${created.body.id}`).expect(200);
    expect(done.body.status).toBe('delivered');
    expect(done.body.events.map((e: { type: string }) => e.type)).toContain('handed_to_rider');
    // The merchant can see the pack photo of their own order.
    await merchant.get(`/photos/${photo.body.id}`).expect(200).expect('content-type', 'image/jpeg');

    // The merchant's home page numbers count this delivery, and only their own orders.
    // Orders are stamped with the real time while this test's clock is fixed, so ask for that day.
    const day = cairoDay(new Date());
    const kpis = await merchant
      .get('/merchant/orders/kpis')
      .query({ from: day, to: day })
      .expect(200);
    expect(kpis.body.totals).toMatchObject({
      orders: 1,
      delivered: 1,
      codCollectedPiastres: expected,
    });
    expect(kpis.body.perDay).toHaveLength(1);
    expect(kpis.body).not.toHaveProperty('perMerchant');
    await staff.get('/merchant/orders/kpis').expect(403);
  });

  it('refuses 60 minute delivery outside the zones or when the store is closed', async () => {
    const merchant = await agent('merchant@evechantelle.example');
    const outside = await merchant
      .post('/merchant/orders')
      .send(await orderBody({ latitude: 31.2, longitude: 29.92 }))
      .expect(409);
    expect(outside.body.error).toBe('outside_zones');
    clock.set(new Date('2026-01-14T06:00:00Z'));
    const closed = await merchant
      .post('/merchant/orders')
      .send(await orderBody())
      .expect(409);
    expect(closed.body.error).toBe('store_closed');
  });

  it('lets admin create an order for a merchant, see alerts and resolve them', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const merchant = await prisma.merchant.findFirstOrThrow();
    await admin
      .post('/admin/orders')
      .send(await orderBody())
      .expect(400);
    const created = await admin
      .post('/admin/orders')
      .send(await orderBody({ merchantId: merchant.id, customerPhone: '12345' }))
      .expect(201);
    expect(created.body.phoneFlagged).toBe(true);
    const alerts = await admin.get('/admin/alerts').expect(200);
    expect(alerts.body[0]).toMatchObject({
      type: 'phone_invalid',
      order: { number: created.body.number },
    });
    await admin.post(`/admin/alerts/${alerts.body[0].id}/resolve`).expect(201);
    await admin.post(`/admin/alerts/${alerts.body[0].id}/resolve`).expect(409);
    expect((await admin.get('/admin/alerts').expect(200)).body).toHaveLength(0);
    const list = await admin.get('/admin/orders').query({ q: created.body.number }).expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('flags late orders from the background job, once', async () => {
    const merchant = await agent('merchant@evechantelle.example');
    const created = await merchant
      .post('/merchant/orders')
      .send(await orderBody())
      .expect(201);
    const jobs = app.get(JobsService);
    const later = new Date(Date.now() + 5 * 60_000);
    expect(await jobs.runSlaCheck(later)).toMatchObject({ flagged: 1 });
    expect(await jobs.runSlaCheck(later)).toMatchObject({ flagged: 0 });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(order.lateStage).toBe('accept');
  });

  it('handles a failed delivery and the return to the store', async () => {
    const merchant = await agent('merchant@evechantelle.example');
    const created = await merchant
      .post('/merchant/orders')
      .send(await orderBody())
      .expect(201);
    const staff = await agent('staff.newcairo@shiplynow.local');
    const base = `/stores/${ncr}/orders/${created.body.id}`;
    await staff.post(`${base}/accept`).expect(201);
    for (const item of (await staff.get(base)).body.items) {
      await staff
        .post(`${base}/pick`)
        .send({ skuId: item.skuId, quantity: item.quantity, idempotencyKey: randomUUID() })
        .expect(201);
    }
    const photo = await staff
      .post('/photos?kind=pack')
      .set('content-type', 'image/jpeg')
      .send(JPEG)
      .expect(201);
    await staff.post(`${base}/pack`).send({ photoId: photo.body.id }).expect(201);
    await staff.post(`${base}/handover`).send({ badgeCode: 'RDR-0001' }).expect(201);

    const rider = await agent('rider.newcairo@shiplynow.local');
    const [delivery] = (await rider.get('/rider/deliveries')).body;
    await rider
      .post(`/rider/deliveries/${delivery.id}/fail`)
      .send({ reason: 'no_answer' })
      .expect(201);
    const returned = await staff.post(`${base}/return`).expect(201);
    expect(returned.body).toMatchObject({ bin: 'HLD-01', units: 3 });
    expect((await merchant.get(`/merchant/orders/${created.body.id}`)).body.status).toBe('failed');
  });

  it('keeps each role in its lane', async () => {
    const merchant = await agent('merchant@evechantelle.example');
    const created = await merchant
      .post('/merchant/orders')
      .send(await orderBody())
      .expect(201);
    const rider = await agent('rider.newcairo@shiplynow.local');
    await rider.get(`/stores/${ncr}/orders`).expect(403);
    await merchant
      .post('/photos?kind=pack')
      .set('content-type', 'image/jpeg')
      .send(JPEG)
      .expect(403);
    const maadi = await agent('staff.maadi@shiplynow.local');
    await maadi.get(`/stores/${ncr}/orders/${created.body.id}`).expect(403);
    const staff = await agent('staff.newcairo@shiplynow.local');
    const wrongType = await staff
      .post('/photos?kind=pack')
      .set('content-type', 'image/jpeg')
      .send(Buffer.alloc(0));
    expect(wrongType.status).toBe(400);
    await merchant.post(`/merchant/orders/${created.body.id}/cancel`).expect(201);
    expect((await merchant.get(`/merchant/orders/${created.body.id}`)).body.status).toBe(
      'cancelled',
    );
  });
});
