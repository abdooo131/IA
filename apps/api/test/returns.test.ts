import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';

describe('returns to the merchant end to end', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ncr: string;
  let maadi: string;

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
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
    maadi = seeded.stores.get('MAA')!;
  });

  it('merchant asks, staff pick by scan and hand over, merchant sees it collected', async () => {
    const merchant = await agent('merchant@evechantelle.example');
    const stock = await merchant.get(`/merchant/returns/stock?darkStoreId=${ncr}`).expect(200);
    const row = stock.body.find((r: { sellable: number }) => r.sellable >= 2);
    expect(row).toBeDefined();

    const created = await merchant
      .post('/merchant/returns')
      .send({
        darkStoreId: ncr,
        note: 'End of season',
        lines: [{ skuId: row.skuId, source: 'sellable', quantity: 2 }],
      })
      .expect(201);
    expect(created.body.reference).toBe('RET-1001');
    await merchant
      .post('/merchant/returns')
      .send({
        darkStoreId: ncr,
        lines: [{ skuId: row.skuId, source: 'sellable', quantity: 100000 }],
      })
      .expect(409);

    // Store staff of another store cannot see it; New Cairo staff can.
    const maadiStaff = await agent('staff.maadi@shiplynow.local');
    await maadiStaff.get(`/stores/${ncr}/returns`).expect(403);
    const staff = await agent('staff.newcairo@shiplynow.local');
    const open = await staff.get(`/stores/${ncr}/returns`).expect(200);
    expect(open.body).toHaveLength(1);
    const summary = await staff.get(`/stores/${ncr}/summary`).expect(200);
    expect(summary.body.openReturns).toBe(1);

    const base = `/stores/${ncr}/returns/${created.body.id}`;
    await staff.post(`${base}/hand-over`).send({ collectedBy: 'Driver Mona' }).expect(409);
    await staff
      .post(`${base}/pick`)
      .send({ skuId: row.skuId, idempotencyKey: randomUUID() })
      .expect(201);
    const last = await staff
      .post(`${base}/pick`)
      .send({ skuId: row.skuId, idempotencyKey: randomUUID() })
      .expect(201);
    expect(last.body.status).toBe('ready');
    await merchant.post(`/merchant/returns/${created.body.id}/cancel`).send({}).expect(409);
    await staff.post(`${base}/hand-over`).send({ collectedBy: 'Driver Mona' }).expect(201);

    const seen = await merchant.get(`/merchant/returns/${created.body.id}`).expect(200);
    expect(seen.body).toMatchObject({ status: 'collected', collectedBy: 'Driver Mona' });
    const notices = await prisma.notification.findMany({ where: { type: 'return_collected' } });
    expect(notices).toHaveLength(1);

    const admin = await agent('admin@test.eg', 'admin-password-1');
    const all = await admin.get('/admin/returns?status=collected').expect(200);
    expect(all.body).toHaveLength(1);
    expect(maadi).toBeDefined();
  });

  it('merchant cancels before picking and the units are on sale again', async () => {
    const merchant = await agent('merchant@evechantelle.example');
    const stock = await merchant.get(`/merchant/returns/stock?darkStoreId=${ncr}`).expect(200);
    const row = stock.body[0];
    const created = await merchant
      .post('/merchant/returns')
      .send({ darkStoreId: ncr, lines: [{ skuId: row.skuId, source: 'sellable', quantity: 1 }] })
      .expect(201);
    const during = await merchant.get(`/merchant/returns/stock?darkStoreId=${ncr}`).expect(200);
    expect(during.body.find((r: { skuId: string }) => r.skuId === row.skuId)?.sellable ?? 0).toBe(
      row.sellable - 1,
    );
    await merchant.post(`/merchant/returns/${created.body.id}/cancel`).send({}).expect(201);
    const after = await merchant.get(`/merchant/returns/stock?darkStoreId=${ncr}`).expect(200);
    expect(after.body.find((r: { skuId: string }) => r.skuId === row.skuId).sellable).toBe(
      row.sellable,
    );
  });
});
