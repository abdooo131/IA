import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JobsService } from '../src/jobs/jobs.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, FixedClock, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';

describe('customer base (admin only)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const clock = new FixedClock(new Date('2026-01-14T10:00:00Z'));

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
    await resetAndSeed(prisma);
  });

  it('keeps customer insight and risk alerts away from merchants', async () => {
    const merchant = await agent('merchant@evechantelle.example');
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const sku = await prisma.sku.findFirstOrThrow({ where: { sku: 'EC-001' } });
    const created = await merchant
      .post('/merchant/orders')
      .send({
        customerName: 'Sara Ali',
        customerPhone: '0101 234 5678',
        addressText: 'Villa 12, South 90th St',
        latitude: 30.03,
        longitude: 31.47,
        paymentMethod: 'cod',
        deliveryFeePiastres: 3000,
        items: [{ skuId: sku.id, quantity: 1 }],
      })
      .expect(201);
    await app.get(JobsService).runCustomerLinks();
    const order = await prisma.order.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(order.customerId).not.toBeNull();
    await prisma.alert.create({
      data: {
        type: 'cod_risk_customer',
        stage: 'customer',
        orderId: order.id,
        darkStoreId: order.darkStoreId,
        data: { customerId: order.customerId, level: 'high' },
      },
    });

    const seen = await merchant.get(`/merchant/orders/${order.id}`).expect(200);
    expect(seen.body.alerts).toEqual([]);
    expect(JSON.stringify(seen.body)).not.toContain('cod_risk_customer');
    const adminView = await admin.get(`/admin/orders/${order.id}`).expect(200);
    expect(adminView.body.alerts.map((a: { type: string }) => a.type)).toContain(
      'cod_risk_customer',
    );

    for (const path of [
      '/admin/customers',
      '/admin/customers/overview',
      '/admin/customers/places',
      `/admin/customers/by-order/${order.id}`,
      `/admin/customers/${order.customerId}`,
      '/admin/customers/export',
    ])
      await merchant.get(path).expect(403);
    await merchant
      .post(`/admin/customers/${order.customerId}/merge`)
      .send({ mergeId: 'x' })
      .expect(403);

    const who = await admin.get(`/admin/customers/by-order/${order.id}`).expect(200);
    expect(who.body).toMatchObject({
      customer: { id: order.customerId, phone: '+201012345678' },
      risk: { level: 'unknown', attempts: 0 },
    });
    await admin.get('/admin/customers/places').expect(200);
    await admin
      .post(`/admin/customers/${order.customerId}/merge`)
      .send({ mergeId: order.customerId })
      .expect(400);
    await admin
      .post(`/admin/customers/${order.customerId}/merge`)
      .send({ mergeId: 'missing' })
      .expect(404);
    await admin.post(`/admin/customers/${order.customerId}/merge`).send({}).expect(400);
    const data = await admin.get(`/admin/data/merchants/${order.merchantId}`).expect(200);
    expect(data.body.crossSell).toMatchObject({ customers: 1, alsoBuyElsewhere: 0 });
    expect(data.body.orderHistory).toEqual([]);
  });

  it('exports a segment as CSV, for marketing only with consent, and audits it', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const merchant = await prisma.merchant.findFirstOrThrow();
    const shop = await prisma.shopifyShop.create({
      data: { merchantId: merchant.id, shopDomain: 'export-test.myshopify.com', status: 'active' },
    });
    const sara = await prisma.customer.create({
      data: {
        phone: '+201012345678',
        email: 'sara@example.com',
        name: '=Sara',
        firstSeenAt: clock.now(),
        lastSeenAt: clock.now(),
      },
    });
    await prisma.customer.create({
      data: {
        phone: '+201112345678',
        name: 'Omar',
        firstSeenAt: clock.now(),
        lastSeenAt: clock.now(),
      },
    });
    await prisma.shopCustomer.create({
      data: {
        shopId: shop.id,
        merchantId: merchant.id,
        shopifyId: 'gid://shopify/Customer/1',
        customerId: sara.id,
        emailMarketing: 'SUBSCRIBED',
        smsMarketing: 'NOT_SUBSCRIBED',
        raw: {},
      },
    });
    await prisma.shopOrder.create({
      data: {
        shopId: shop.id,
        merchantId: merchant.id,
        shopifyId: 'gid://shopify/Order/1',
        name: '#1',
        createdAtShop: clock.now(),
        currency: 'EGP',
        totalPiastres: 10_000,
        raw: {},
      },
    });

    const all = await admin.get('/admin/customers/export?segment=no_orders').expect(200);
    expect(all.headers['content-type']).toContain('text/csv');
    expect(all.text.charCodeAt(0)).toBe(0xfeff);
    const lines = all.text.slice(1).trim().split('\r\n');
    expect(lines[0]).toBe('phone,email,name,segment,email_marketing,sms_marketing,last_order');
    expect(lines).toHaveLength(3);
    // A name that looks like a formula never runs in Excel.
    expect(all.text).toContain("'=Sara");

    const marketing = await admin.get('/admin/customers/export?marketing=1').expect(200);
    const rows = marketing.text.slice(1).trim().split('\r\n');
    expect(rows).toHaveLength(2);
    // Email consent only: the phone is left out.
    expect(rows[1]).toBe(",sara@example.com,'=Sara,no_orders,SUBSCRIBED,NOT_SUBSCRIBED,");

    const audits = await prisma.auditLog.findMany({
      where: { action: 'customer.export' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map((a) => a.after)).toEqual([
      { segment: 'no_orders', marketing: false, rows: 2 },
      { segment: null, marketing: true, rows: 1 },
    ]);

    const market = await admin.get('/admin/data/market').expect(200);
    expect(market.body.orderHistory).toEqual([
      expect.objectContaining({ shopId: shop.id, orders: 1, complete: false }),
    ]);
    const overview = await admin.get('/admin/customers/overview').expect(200);
    expect(overview.body).toMatchObject({ fromShopifyTotals: 0 });
    expect(overview.body.orderHistory).toHaveLength(1);
  });
});
