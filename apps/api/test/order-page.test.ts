import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { cairoDay } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, FixedClock, resetAndSeed, contractPrices } from './helpers';

const DEMO = 'demo-password-1';
const NOON_CAIRO = new Date('2026-01-14T10:00:00Z');
const NEW_CAIRO = { latitude: 30.03, longitude: 31.47 };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
// Ledger entries carry the real time, so payout days use the real Cairo day.
const today = cairoDay(new Date());

describe('order page: notes, money and what each viewer sees', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ncr: string;
  let merchantId: string;
  const clock = new FixedClock(NOON_CAIRO);

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };

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
    merchantId = (await prisma.merchant.findFirstOrThrow()).id;
  });

  async function placeOrder() {
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
    return { merchant, sku, id: created.body.id as string };
  }

  /** Runs the order through the store to the rider; returns the rider's delivery id. */
  async function toRider(id: string, skuId: string) {
    const staff = await agent('staff.newcairo@shiplynow.local');
    const base = `/stores/${ncr}/orders/${id}`;
    await staff.post(`${base}/accept`).expect(201);
    await staff
      .post(`${base}/pick`)
      .send({ skuId, quantity: 2, idempotencyKey: randomUUID() })
      .expect(201);
    const photo = await staff
      .post('/photos?kind=pack')
      .set('content-type', 'image/jpeg')
      .send(JPEG)
      .expect(201);
    await staff.post(`${base}/pack`).send({ photoId: photo.body.id }).expect(201);
    await staff.post(`${base}/handover`).send({ badgeCode: 'RDR-0001' }).expect(201);
    const rider = await agent('rider.newcairo@shiplynow.local');
    const deliveries = await rider.get('/rider/deliveries').expect(200);
    return { rider, staff, deliveryId: deliveries.body[0].id as string };
  }

  it('keeps team notes internal and shares the merchant thread', async () => {
    const { merchant, id } = await placeOrder();
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const staff = await agent('staff.newcairo@shiplynow.local');
    const otherStaff = await agent('staff.maadi@shiplynow.local');

    await admin
      .post(`/admin/orders/${id}/notes`)
      .send({ audience: 'team', body: 'Customer asked for a call first' })
      .expect(201);
    await staff
      .post(`/stores/${ncr}/orders/${id}/notes`)
      .send({ audience: 'merchant', body: 'One unit has a dented box' })
      .expect(201);
    // A merchant always writes to the merchant thread, whatever they ask for.
    await merchant
      .post(`/merchant/orders/${id}/notes`)
      .send({ audience: 'team', body: 'Please deliver before 3' })
      .expect(201);
    await merchant.post(`/merchant/orders/${id}/notes`).send({ body: '   ' }).expect(400);

    const team = await admin.get(`/admin/orders/${id}/notes`).expect(200);
    expect(team.body.map((n: { audience: string; body: string }) => [n.audience, n.body])).toEqual([
      ['team', 'Customer asked for a call first'],
      ['merchant', 'One unit has a dented box'],
      ['merchant', 'Please deliver before 3'],
    ]);
    expect(team.body[2]).toMatchObject({ fromMerchant: true });
    expect((await staff.get(`/stores/${ncr}/orders/${id}/notes`).expect(200)).body).toHaveLength(3);

    const shared = await merchant.get(`/merchant/orders/${id}/notes`).expect(200);
    expect(shared.body.map((n: { body: string }) => n.body)).toEqual([
      'One unit has a dented box',
      'Please deliver before 3',
    ]);
    expect(JSON.stringify(shared.body)).not.toContain('call first');

    // Staff of another store, merchants on team routes, riders: refused.
    const maadi = (await prisma.darkStore.findFirstOrThrow({ where: { code: 'MAA' } })).id;
    await otherStaff.get(`/stores/${ncr}/orders/${id}/notes`).expect(403);
    await otherStaff.get(`/stores/${maadi}/orders/${id}/notes`).expect(404);
    await merchant.get(`/admin/orders/${id}/notes`).expect(403);
    const rider = await agent('rider.newcairo@shiplynow.local');
    await rider.get(`/merchant/orders/${id}/notes`).expect(403);

    // Notes are append only and audited.
    await expect(prisma.$executeRawUnsafe(`UPDATE order_notes SET body = 'x'`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`DELETE FROM order_notes`)).rejects.toThrow();
    expect(await prisma.auditLog.count({ where: { action: 'order.note', entityId: id } })).toBe(3);
  });

  it('breaks down the fees from the ledger and follows the money to the payout', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    for (const [key, value, scope] of [
      ['fee.order_percent_bp', 200, 'global'],
      ['fee.cod_percent_bp', 100, 'global'],
      ['fee.vat_bp', 1400, 'global'],
    ] as const)
      await admin.put('/admin/settings').send({ key, value, scope }).expect(200);
    await contractPrices(admin, merchantId, { orderFixedPiastres: 4000 });

    const { merchant, sku, id } = await placeOrder();
    const before = await merchant.get(`/merchant/orders/${id}/money`).expect(200);
    expect(before.body).toMatchObject({ fees: [], duesPiastres: 0, payout: null });

    const { rider, deliveryId } = await toRider(id, sku.id);
    const order = await prisma.order.findUniqueOrThrow({ where: { id } });
    const cash = order.codAmountPiastres; // 2 x 325.00 + 30.00
    await rider
      .post(`/rider/deliveries/${deliveryId}/complete`)
      .send({ otp: order.deliveryOtp, codCollectedPiastres: cash })
      .expect(201);

    // 40.00 fixed + 2% of 650.00 = 13.00; COD fee 1% of 680.00 = 6.80; VAT 14% on each fee.
    const vat = 560 + 182 + 95;
    const dues = 4000 + 1300 + 680 + vat;
    const money = await merchant.get(`/merchant/orders/${id}/money`).expect(200);
    expect(money.body).toMatchObject({
      paymentMethod: 'cod',
      productValuePiastres: 65000,
      codAmountPiastres: cash,
      codCreditedPiastres: cash,
      fees: [
        { kind: 'order_fixed', amountPiastres: 4000, percentBp: null },
        { kind: 'order_percent', amountPiastres: 1300, percentBp: 200 },
        { kind: 'cod_fee', amountPiastres: 680, percentBp: 100 },
      ],
      vatPiastres: vat,
      duesPiastres: dues,
      netPiastres: cash - dues,
      payout: { status: 'next' },
    });
    // The numbers are the ledger's: what the order moved on the merchant's wallet.
    const onWallet = await prisma.ledgerLine.aggregate({
      where: { entry: { orderId: id }, account: { type: 'merchant' } },
      _sum: { amountPiastres: true },
    });
    expect(-(onWallet._sum.amountPiastres ?? 0)).toBe(money.body.netPiastres);
    // Admin sees the same numbers.
    const adminMoney = await admin.get(`/admin/orders/${id}/money`).expect(200);
    expect(adminMoney.body).toEqual(money.body);

    const payout = await admin
      .post('/finance/payouts')
      .send({ merchantId, cutoffDay: today })
      .expect(201);
    const { number } = await prisma.payout.findUniqueOrThrow({ where: { id: payout.body.id } });
    expect((await merchant.get(`/merchant/orders/${id}/money`)).body.payout).toEqual({
      status: 'draft',
      number,
    });
    await admin
      .post(`/finance/payouts/${payout.body.id}/paid`)
      .send({ reference: 'TRX-9' })
      .expect(201);
    expect((await merchant.get(`/merchant/orders/${id}/money`)).body.payout).toMatchObject({
      status: 'paid',
      number,
      reference: 'TRX-9',
    });

    // Store staff work the order but do not see its money.
    const staff = await agent('staff.newcairo@shiplynow.local');
    await staff.get(`/admin/orders/${id}/money`).expect(403);
  });

  it('never gives the merchant the delivery code, the tracking link or customer insight', async () => {
    const { merchant, sku, id } = await placeOrder();
    await toRider(id, sku.id);
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const full = await admin.get(`/admin/orders/${id}`).expect(200);
    expect(full.body.deliveryOtp).toMatch(/^\d{4}$/);
    expect(full.body).toMatchObject({ maxAttempts: 2, rating: null });

    const seen = await merchant.get(`/merchant/orders/${id}`).expect(200);
    expect(seen.body).not.toHaveProperty('deliveryOtp');
    expect(seen.body).not.toHaveProperty('trackingToken');
    expect(JSON.stringify(seen.body)).not.toContain(full.body.deliveryOtp);
    expect(seen.body).toMatchObject({ maxAttempts: 2, items: [{ imageUrl: null }] });
    await merchant.get(`/admin/customers/by-order/${id}`).expect(403);
    const money = await merchant.get(`/merchant/orders/${id}/money`).expect(200);
    expect(JSON.stringify(money.body)).not.toContain(full.body.deliveryOtp);
  });
});
