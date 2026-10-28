import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { hashPassword } from '@shiplynow/db';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';

describe('hub and transfers end to end', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ncr: string;
  let maa: string;

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
    maa = seeded.stores.get('MAA')!;
  });

  it('admin opens a hub; New Cairo stock reaches Maadi through it', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const created = await admin
      .post('/admin/dark-stores')
      .send({
        kind: 'hub',
        code: 'hub',
        nameEn: 'Main sorting facility',
        nameAr: 'مركز الفرز الرئيسي',
        addressEn: 'Obour industrial zone',
        addressAr: 'المنطقة الصناعية بالعبور',
        governorateId: 4,
        latitude: 30.22,
        longitude: 31.47,
        shelves: 4,
      })
      .expect(201);
    const hub = created.body.id as string;
    await admin
      .post('/admin/zones')
      .send({
        darkStoreId: hub,
        code: 'HUB-Z',
        nameEn: 'Hub area',
        nameAr: 'منطقة',
        area: {
          type: 'Polygon',
          coordinates: [
            [
              [31.4, 30.2],
              [31.5, 30.2],
              [31.5, 30.3],
              [31.4, 30.2],
            ],
          ],
        },
      })
      .expect(409);
    const hubStaff = await prisma.user.create({
      data: {
        email: 'staff.hub@test.eg',
        name: 'Hub Staff',
        role: 'store_staff',
        darkStoreId: hub,
        passwordHash: await hashPassword(DEMO),
      },
    });
    expect(hubStaff.id).toBeDefined();

    // Merchants now ship to the hub only.
    const merchant = await agent('merchant@evechantelle.example');
    const where = await merchant.get('/merchant/dark-stores').expect(200);
    expect(where.body.map((s: { id: string }) => s.id)).toEqual([hub]);

    const sku = await prisma.stockLevel.findFirstOrThrow({
      where: { darkStoreId: ncr, onHand: { gt: 3 } },
    });
    const t = await admin
      .post('/admin/transfers')
      .send({ fromId: ncr, toId: maa, lines: [{ skuId: sku.skuId, quantity: 2 }] })
      .expect(201);
    expect(t.body.toId).toBe(hub);

    const scan = { skuId: sku.skuId, quantity: 2 };
    const ncrStaff = await agent('staff.newcairo@shiplynow.local');
    const out = await ncrStaff.get(`/stores/${ncr}/transfers`).expect(200);
    expect(out.body.outgoing).toHaveLength(1);
    await ncrStaff
      .post(`/stores/${ncr}/transfers/${t.body.id}/pick`)
      .send({ ...scan, idempotencyKey: randomUUID() })
      .expect(201);
    await ncrStaff.post(`/stores/${ncr}/transfers/${t.body.id}/send`).expect(201);

    const hubAgent = await agent('staff.hub@test.eg');
    const summary = await hubAgent.get(`/stores/${hub}/summary`).expect(200);
    expect(summary.body).toMatchObject({ store: { kind: 'hub' }, transfersToReceive: 1 });
    await hubAgent
      .post(`/stores/${hub}/transfers/${t.body.id}/receive`)
      .send({ ...scan, idempotencyKey: randomUUID() })
      .expect(201);
    const closed = await hubAgent.post(`/stores/${hub}/transfers/${t.body.id}/close`).expect(201);
    const onward = closed.body.onwardId as string;
    await hubAgent
      .post(`/stores/${hub}/transfers/${onward}/pick`)
      .send({ ...scan, idempotencyKey: randomUUID() })
      .expect(201);
    await hubAgent.post(`/stores/${hub}/transfers/${onward}/send`).expect(201);

    // Maadi staff receive; New Cairo staff cannot touch Maadi's receipt.
    await ncrStaff.post(`/stores/${maa}/transfers/${onward}/close`).expect(403);
    const maaStaff = await agent('staff.maadi@shiplynow.local');
    await maaStaff
      .post(`/stores/${maa}/transfers/${onward}/receive`)
      .send({ ...scan, idempotencyKey: randomUUID() })
      .expect(201);
    await maaStaff.post(`/stores/${maa}/transfers/${onward}/close`).expect(201);

    const all = await admin.get('/admin/transfers?status=received').expect(200);
    expect(all.body).toHaveLength(2);
    await ncrStaff.get('/admin/transfers').expect(403);
  });
});
