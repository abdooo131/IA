import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { cairoDay } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assignArea, cleanUpAreas, forgetAreaNames, loadBaseAreas } from '@shiplynow/db';
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
    expect(merchantView.body.trackingToken).toBeUndefined();
    expect(merchantView.body.status).toBe('out_for_delivery');
    expect(merchantView.body).toMatchObject({ buyerHidden: false });
    expect(merchantView.body.customerName).not.toBe('');
    // A buyer Shopify asked us to forget (redact) is hidden from the merchant, kept for us.
    await prisma.order.update({
      where: { id: created.body.id },
      data: { buyerRedactedAt: new Date() },
    });
    const redacted = (await merchant.get(`/merchant/orders/${created.body.id}`).expect(200)).body;
    expect(redacted).toMatchObject({
      buyerHidden: true,
      customerName: '',
      customerPhone: '',
      addressText: '',
    });
    const [listed] = (await merchant.get('/merchant/orders').expect(200)).body;
    expect(listed).toMatchObject({ buyerHidden: true, customerName: '' });
    expect((await admin.get(`/admin/orders/${created.body.id}`)).body.customerName).not.toBe('');
    await prisma.order.update({
      where: { id: created.body.id },
      data: { buyerRedactedAt: null },
    });

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
      .send({
        otp: adminView.body.deliveryOtp,
        codCollectedPiastres: expected,
        lat: 30.0301,
        lng: 31.4702,
      })
      .expect(201);
    // Where the phone stood is kept on the delivery and teaches the address.
    const delivery = await prisma.delivery.findFirstOrThrow({
      where: { orderId: created.body.id },
    });
    expect(delivery).toMatchObject({ deliveredLat: 30.0301, deliveredLng: 31.4702 });
    expect(await prisma.deliveredPoint.count({ where: { orderId: created.body.id } })).toBe(1);
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

  it('answers a repeated manual order with the first order, even after the store closed', async () => {
    const merchant = await agent('merchant@evechantelle.example');
    const body = await orderBody({ idempotencyKey: 'form-key-0001' });
    const first = await merchant.post('/merchant/orders').send(body).expect(201);
    const again = await merchant.post('/merchant/orders').send(body).expect(201);
    expect(again.body).toEqual(first.body);
    // A retry hours later answers the order already made, before any store or capacity check.
    clock.set(new Date(NOON_CAIRO.getTime() + 13 * 3_600_000));
    expect((await merchant.post('/merchant/orders').send(body).expect(201)).body.id).toBe(
      first.body.id,
    );
    expect(await prisma.order.count()).toBe(1);
    // The same key from admin for another merchant is another order key altogether.
    expect((await prisma.order.findFirstOrThrow()).idempotencyKey).toMatch(/:form-key-0001$/);
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

  it('takes the neighbourhood picked instead of a pin, and never a made up point', async () => {
    await loadBaseAreas(prisma);
    await cleanUpAreas(prisma);
    forgetAreaNames();
    const newCairo = await prisma.geoArea.findFirstOrThrow({
      where: { level: 2, nameEn: 'New Cairo', isActive: true },
    });
    const zone = await prisma.zone.findFirstOrThrow({ where: { code: 'NCR-5S' } });
    await prisma.$transaction(
      (tx) => assignArea(tx, { areaId: newCairo.id, zoneId: zone.id, actorUserId: null }),
      { timeout: 60_000 },
    );
    const merchant = await agent('merchant@evechantelle.example');
    const { latitude: _lat, longitude: _lng, ...noPin } = await orderBody();
    void _lat;
    void _lng;
    // Neither a pin nor an area: refused before anything is decided.
    await merchant.post('/merchant/orders').send(noPin).expect(400);
    const created = await merchant
      .post('/merchant/orders')
      .send({ ...noPin, areaId: newCairo.id })
      .expect(201);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(order).toMatchObject({
      darkStoreId: ncr,
      zoneId: zone.id,
      geoAreaId: newCairo.id,
      resolvedBy: 'chosen',
      latitude: null,
      longitude: null,
      locationSource: null,
    });
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

  it('retries a failed delivery once, then takes the goods back for good', async () => {
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

    // First attempt: "no answer" needs two logged calls and a photo at the door.
    const rider = await agent('rider.newcairo@shiplynow.local');
    const [delivery] = (await rider.get('/rider/deliveries')).body;
    const fail = (id: string, body: Record<string, unknown>) =>
      rider.post(`/rider/deliveries/${id}/fail`).send(body);
    expect((await fail(delivery.id, { reason: 'no_answer' }).expect(400)).body).toEqual({
      error: 'calls_required',
    });
    await rider.post(`/rider/deliveries/${delivery.id}/call`).expect(201);
    const call = await rider.post(`/rider/deliveries/${delivery.id}/call`).expect(201);
    expect(call.body).toEqual({ calls: 2, phone: '+201012345678' });
    const door = await rider
      .post('/photos?kind=delivery')
      .set('content-type', 'image/jpeg')
      .send(JPEG)
      .expect(201);
    expect(
      (await fail(delivery.id, { reason: 'no_answer', photoId: door.body.id }).expect(201)).body,
    ).toEqual({ status: 'attempt_failed', attempt: 1, maxAttempts: 2 });

    // The store queue shows it waiting; the merchant cannot retry before the goods are back.
    const queue = (await staff.get(`/stores/${ncr}/orders`)).body;
    expect(queue.find((o: { id: string }) => o.id === created.body.id)).toMatchObject({
      status: 'attempt_failed',
      goodsBack: false,
    });
    const decide = (body: Record<string, unknown>) =>
      merchant.post(`/merchant/orders/${created.body.id}/decision`).send(body);
    expect((await decide({ action: 'retry' }).expect(409)).body).toEqual({
      error: 'goods_not_back',
    });
    expect((await staff.post(`${base}/return`).expect(201)).body).toMatchObject({
      keptForRetry: true,
      units: 0,
    });
    const detail = (await merchant.get(`/merchant/orders/${created.body.id}`)).body;
    expect(detail).toMatchObject({ status: 'attempt_failed', goodsBack: true });
    expect(detail.deliveries[0]).toMatchObject({ callAttempts: 2, failedPhotoId: door.body.id });
    // The merchant sees the door photo of their own order.
    await merchant.get(`/photos/${door.body.id}`).expect(200);
    await decide({ action: 'retry' }).expect(201);

    // Second and last attempt: the order fails for good, the goods go to the held bin.
    await staff.post(`${base}/handover`).send({ badgeCode: 'RDR-0001' }).expect(201);
    const second = (await rider.get('/rider/deliveries')).body.find(
      (d: { status: string }) => d.status === 'picked_up',
    );
    expect((await fail(second.id, { reason: 'wrong_address' }).expect(201)).body).toMatchObject({
      status: 'failed',
      attempt: 2,
    });
    expect((await staff.post(`${base}/return`).expect(201)).body).toMatchObject({
      bin: 'HLD-01',
      units: 3,
    });
    expect((await merchant.get(`/merchant/orders/${created.body.id}`)).body.status).toBe('failed');
    expect((await decide({ action: 'retry' }).expect(409)).body).toEqual({
      error: 'invalid_order_state',
    });
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
  it('lets a manager close a delivery for the rider, and keeps merchants to new and accepted', async () => {
    const merchant = await agent('merchant@evechantelle.example');
    const staff = await agent('staff.newcairo@shiplynow.local');
    const outForDelivery = async () => {
      const created = await merchant
        .post('/merchant/orders')
        .send(await orderBody())
        .expect(201);
      const base = `/stores/${ncr}/orders/${created.body.id}`;
      await staff.post(`${base}/accept`).expect(201);
      const detail = await staff.get(base).expect(200);
      for (const item of detail.body.items)
        await staff
          .post(`${base}/pick`)
          .send({ skuId: item.skuId, quantity: item.quantity, idempotencyKey: randomUUID() })
          .expect(201);
      // Picking has started: the merchant may no longer cancel.
      const late = await merchant.post(`/merchant/orders/${created.body.id}/cancel`).expect(409);
      expect(late.body).toEqual({ error: 'too_late_to_cancel' });
      const photo = await staff
        .post('/photos?kind=pack')
        .set('content-type', 'image/jpeg')
        .send(JPEG)
        .expect(201);
      await staff.post(`${base}/pack`).send({ photoId: photo.body.id }).expect(201);
      await staff.post(`${base}/handover`).send({ badgeCode: 'RDR-0001' }).expect(201);
      return { id: created.body.id as string, base };
    };

    // Store staff without store manage may not; admin (operations manage) closes it as failed.
    const first = await outForDelivery();
    const reason = 'Rider phone stopped working';
    await staff
      .post(`${first.base}/close-for-rider`)
      .send({ outcome: 'failed', reason, failureReason: 'wrong_address' })
      .expect(403);
    const admin = await agent('admin@test.eg', 'admin-password-1');
    await admin
      .post(`/admin/orders/${first.id}/close-for-rider`)
      .send({ outcome: 'failed', reason: 'no' })
      .expect(400);
    const failed = await admin
      .post(`/admin/orders/${first.id}/close-for-rider`)
      .send({ outcome: 'failed', reason, failureReason: 'wrong_address' })
      .expect(201);
    expect(failed.body).toMatchObject({ status: 'attempt_failed', attempt: 1 });

    // A store manager of the order's store closes the next one as delivered with the cash.
    const second = await outForDelivery();
    const staffUser = await prisma.user.findFirstOrThrow({
      where: { email: 'staff.newcairo@shiplynow.local' },
    });
    await prisma.userAccess.update({ where: { userId: staffUser.id }, data: { store: 'manage' } });
    const delivery = await prisma.delivery.findFirstOrThrow({ where: { orderId: second.id } });
    const done = await staff
      .post(`${second.base}/close-for-rider`)
      .send({ outcome: 'delivered', reason, codCollectedPiastres: delivery.codExpectedPiastres })
      .expect(201);
    expect(done.body).toMatchObject({ status: 'delivered', riderId: delivery.riderId });
    const rider = await agent('rider.newcairo@shiplynow.local');
    await rider
      .post(`/rider/deliveries/${delivery.id}/complete`)
      .send({ otp: '0000', codCollectedPiastres: 0 })
      .expect(409);
  });
});
