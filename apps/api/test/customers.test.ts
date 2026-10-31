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
  });
});
