import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, FixedClock, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';

describe('store staff app, merchant panel and count approvals', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let stores: Map<string, string>;
  let ncr: string;

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({
      clock: new FixedClock(new Date('2026-01-14T10:00:00Z')),
    }));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    ({ stores } = await resetAndSeed(prisma));
    ncr = stores.get('NCR')!;
  });

  async function skuByCode(code: string) {
    return prisma.sku.findFirstOrThrow({ where: { sku: code } });
  }

  async function bin(storeId: string, code: string) {
    return prisma.bin.findFirstOrThrow({ where: { darkStoreId: storeId, code } });
  }

  it('limits staff to their own store', async () => {
    const staff = await agent('staff.newcairo@shiplynow.local');
    const mine = await staff.get('/stores').expect(200);
    expect(mine.body.map((s: { code: string }) => s.code)).toEqual(['NCR']);
    await staff.get(`/stores/${ncr}/summary`).expect(200);
    await staff.get(`/stores/${stores.get('MAA')}/summary`).expect(403);
    const rider = await agent('rider.newcairo@shiplynow.local');
    await rider.get(`/stores/${ncr}/summary`).expect(403);
  });

  it('resolves scanned codes to products and bins', async () => {
    const staff = await agent('staff.newcairo@shiplynow.local');
    const sku = await skuByCode('EC-003');
    const byBarcode = await staff
      .get(`/stores/${ncr}/lookup`)
      .query({ code: sku.barcode })
      .expect(200);
    expect(byBarcode.body).toMatchObject({ kind: 'sku', sku: { sku: 'EC-003' } });
    const bySku = await staff.get(`/stores/${ncr}/lookup`).query({ code: 'ec-003' }).expect(200);
    expect(bySku.body.kind).toBe('sku');
    const byBin = await staff.get(`/stores/${ncr}/lookup`).query({ code: 'a-02' }).expect(200);
    expect(byBin.body).toMatchObject({ kind: 'bin', bin: { code: 'A-02', type: 'pickable' } });
    const missing = await staff.get(`/stores/${ncr}/lookup`).query({ code: 'nothing' }).expect(404);
    expect(missing.body.error).toBe('code_not_found');
  });

  it('merchant ships, staff receive 10 units and put them away, admin sees the stock', async () => {
    const sku = await skuByCode('EC-019');
    const merchant = await agent('merchant@evechantelle.example');
    const created = await merchant
      .post('/merchant/manifests')
      .send({ darkStoreId: ncr, reference: 'PO-1001', lines: [{ skuId: sku.id, expectedQty: 10 }] })
      .expect(201);

    const admin = await agent('admin@test.eg', 'admin-password-1');
    const before = (
      await admin.get('/admin/stock').query({ darkStoreId: ncr }).expect(200)
    ).body.find((r: { sku: { sku: string } }) => r.sku.sku === 'EC-019').onHand;

    const staff = await agent('staff.newcairo@shiplynow.local');
    const open = await staff.get(`/stores/${ncr}/manifests`).expect(200);
    expect(open.body).toEqual([
      expect.objectContaining({ reference: 'PO-1001', expectedUnits: 10, receivedUnits: 0 }),
    ]);

    for (let i = 0; i < 10; i++) {
      await staff
        .post(`/stores/${ncr}/manifests/${created.body.id}/receive`)
        .send({ skuId: sku.id, quantity: 1, idempotencyKey: randomUUID() })
        .expect(201);
    }
    // A double tap with the same key counts once.
    const key = randomUUID();
    await staff
      .post(`/stores/${ncr}/manifests/${created.body.id}/receive`)
      .send({ skuId: sku.id, quantity: 1, idempotencyKey: key });
    const replay = await staff
      .post(`/stores/${ncr}/manifests/${created.body.id}/receive`)
      .send({ skuId: sku.id, quantity: 1, idempotencyKey: key })
      .expect(201);
    expect(replay.body.replayed).toBe(true);

    const detail = await staff.get(`/stores/${ncr}/manifests/${created.body.id}`).expect(200);
    expect(detail.body.lines[0]).toMatchObject({ expectedQty: 10, receivedQty: 11 });
    expect((await staff.get(`/stores/${ncr}/summary`).expect(200)).body.unitsToPutAway).toBe(11);

    const shelf = await bin(ncr, 'A-02');
    await staff
      .post(`/stores/${ncr}/put-away`)
      .send({ skuId: sku.id, toBinId: shelf.id, quantity: 11, idempotencyKey: randomUUID() })
      .expect(201);
    await staff.post(`/stores/${ncr}/manifests/${created.body.id}/close`).expect(201);

    const after = (
      await admin.get('/admin/stock').query({ darkStoreId: ncr }).expect(200)
    ).body.find((r: { sku: { sku: string } }) => r.sku.sku === 'EC-019').onHand;
    expect(after - before).toBe(11);

    const shipments = await merchant.get('/merchant/manifests').expect(200);
    expect(shipments.body[0]).toMatchObject({ reference: 'PO-1001', status: 'received' });
    const notes = await merchant.get('/merchant/notifications').expect(200);
    expect(notes.body[0]).toMatchObject({ type: 'manifest_received', readAt: null });
    await merchant.post(`/merchant/notifications/${notes.body[0].id}/read`).expect(201);
    expect((await merchant.get('/merchant/me').expect(200)).body.unreadNotifications).toBe(0);
  });

  it('refuses put away into a non shelf bin and moves that break the bin rules', async () => {
    const staff = await agent('staff.newcairo@shiplynow.local');
    const sku = await skuByCode('EC-001');
    const damaged = await bin(ncr, 'DMG-01');
    const res = await staff
      .post(`/stores/${ncr}/put-away`)
      .send({ skuId: sku.id, toBinId: damaged.id, quantity: 1, idempotencyKey: randomUUID() })
      .expect(400);
    expect(res.body.error).toBe('bin_not_pickable');

    const shelf = (
      await prisma.binStock.findFirstOrThrow({
        where: { skuId: sku.id, quantity: { gt: 2 }, bin: { darkStoreId: ncr, type: 'pickable' } },
        include: { bin: true },
      })
    ).bin;
    // Damage needs its cause, so it goes through a damage report rather than a plain move.
    const plain = await staff
      .post(`/stores/${ncr}/move`)
      .send({
        skuId: sku.id,
        fromBinId: shelf.id,
        toBinId: damaged.id,
        quantity: 2,
        reason: 'damaged',
        idempotencyKey: randomUUID(),
      })
      .expect(400);
    expect(plain.body.error).toBe('cause_required');
    const ok = await staff
      .post(`/stores/${ncr}/damage`)
      .send({
        skuId: sku.id,
        fromBinId: shelf.id,
        quantity: 2,
        cause: 'store_handling',
        idempotencyKey: randomUUID(),
      })
      .expect(201);
    expect(ok.body.status).toBe('pending');
    const wrong = await staff
      .post(`/stores/${ncr}/move`)
      .send({
        skuId: sku.id,
        fromBinId: damaged.id,
        toBinId: shelf.id,
        quantity: 1,
        reason: 'release',
        idempotencyKey: randomUUID(),
      })
      .expect(400);
    expect(wrong.body.error).toBe('move_not_allowed');
    const tooMany = await staff
      .post(`/stores/${ncr}/damage`)
      .send({
        skuId: sku.id,
        fromBinId: shelf.id,
        quantity: 9999,
        cause: 'store_handling',
        idempotencyKey: randomUUID(),
      })
      .expect(409);
    expect(tooMany.body.error).toBe('insufficient_bin_stock');

    // Admin settles: damage in the store is paid to the merchant at the product price.
    const admin = await agent('admin@test.eg', 'admin-password-1');
    await staff.get('/admin/damage').expect(403);
    const pending = await admin.get('/admin/damage?status=pending').expect(200);
    expect(pending.body).toHaveLength(1);
    const settled = await admin
      .post(`/admin/damage/${ok.body.id}/settle`)
      .send({ cause: 'store_handling' })
      .expect(201);
    expect(settled.body.compensationPiastres).toBe(2 * sku.pricePiastres);
    await admin
      .post(`/admin/damage/${ok.body.id}/settle`)
      .send({ cause: 'customer', note: 'x' })
      .expect(409);
    const merchant = await agent('merchant@evechantelle.example');
    const mine = await merchant.get('/merchant/returns/damage').expect(200);
    expect(mine.body[0]).toMatchObject({ status: 'settled', cause: 'store_handling' });
  });

  it('counts wait for admin approval, then adjust stock and notify the merchant', async () => {
    const staff = await agent('staff.newcairo@shiplynow.local');
    const shelf = await bin(ncr, 'A-01');
    const contents = await prisma.binStock.findMany({
      where: { binId: shelf.id, quantity: { gt: 0 } },
      include: { sku: true },
    });
    const [first, ...rest] = contents;
    const lines = [
      { skuId: first!.skuId, countedQty: first!.quantity - 2 },
      ...rest.map((c) => ({ skuId: c.skuId, countedQty: c.quantity })),
    ];
    const submitted = await staff
      .post(`/stores/${ncr}/counts`)
      .send({ binId: shelf.id, lines })
      .expect(201);
    expect(submitted.body.variances).toBe(1);
    expect(
      (
        await prisma.binStock.findUniqueOrThrow({
          where: { binId_skuId: { binId: shelf.id, skuId: first!.skuId } },
        })
      ).quantity,
    ).toBe(first!.quantity);

    await staff.get('/admin/stock-counts').expect(403);
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const pending = await admin
      .get('/admin/stock-counts')
      .query({ status: 'submitted' })
      .expect(200);
    expect(pending.body).toHaveLength(1);
    expect(pending.body[0]).toMatchObject({ bin: { code: 'A-01' }, submittedBy: 'Mona Adel' });

    const approved = await admin
      .post(`/admin/stock-counts/${submitted.body.id}/approve`)
      .expect(201);
    expect(approved.body).toEqual({ status: 'approved', adjusted: 1 });
    expect(
      (
        await prisma.binStock.findUniqueOrThrow({
          where: { binId_skuId: { binId: shelf.id, skuId: first!.skuId } },
        })
      ).quantity,
    ).toBe(first!.quantity - 2);
    const again = await admin.post(`/admin/stock-counts/${submitted.body.id}/approve`).expect(409);
    expect(again.body.error).toBe('count_already_reviewed');

    const merchant = await agent('merchant@evechantelle.example');
    const notes = await merchant.get('/merchant/notifications').expect(200);
    expect(notes.body[0]).toMatchObject({ type: 'stock_count_adjusted' });
    expect(notes.body[0].data.lines[0]).toMatchObject({
      before: first!.quantity,
      after: first!.quantity - 2,
    });
  });

  it('keeps merchants out of staff and admin endpoints and away from other merchants', async () => {
    const merchant = await agent('merchant@evechantelle.example');
    await merchant.get(`/stores/${ncr}/summary`).expect(403);
    await merchant.get('/admin/stock').expect(403);
    const other = await prisma.merchant.create({ data: { name: 'Other brand' } });
    const otherSku = await prisma.sku.create({
      data: { merchantId: other.id, sku: 'OB-1', titleEn: 'x', titleAr: 'x', pricePiastres: 100 },
    });
    const res = await merchant
      .post('/merchant/manifests')
      .send({
        darkStoreId: ncr,
        reference: 'PO-X',
        lines: [{ skuId: otherSku.id, expectedQty: 1 }],
      })
      .expect(400);
    expect(res.body.error).toBe('sku_not_found');
  });

  it('shows a shipment in detail to its merchant and to admin, never to another merchant', async () => {
    const sku = await skuByCode('EC-002');
    const merchant = await agent('merchant@evechantelle.example');
    const created = await merchant
      .post('/merchant/manifests')
      .send({
        darkStoreId: ncr,
        reference: 'PO-DETAIL',
        lines: [{ skuId: sku.id, expectedQty: 5 }],
      })
      .expect(201);
    const staff = await agent('staff.newcairo@shiplynow.local');
    await staff
      .post(`/stores/${ncr}/manifests/${created.body.id}/receive`)
      .send({ skuId: sku.id, quantity: 2, idempotencyKey: randomUUID() })
      .expect(201);

    const mine = await merchant.get(`/merchant/manifests/${created.body.id}`).expect(200);
    expect(mine.body.timeline.map((t: { event: string }) => t.event)).toEqual([
      'created',
      'receiving_started',
    ]);
    expect(mine.body.scans[0]).toMatchObject({ by: 'Mona Adel', quantity: 2, sku: 'EC-002' });
    expect(mine.body.createdBy.name).toBe('Eve Chantelle Ops');

    const admin = await agent('admin@test.eg', 'admin-password-1');
    const list = await admin.get('/admin/manifests').query({ q: 'detail' }).expect(200);
    expect(list.body).toEqual([
      expect.objectContaining({ reference: 'PO-DETAIL', expectedUnits: 5, receivedUnits: 2 }),
    ]);
    await admin.get(`/admin/manifests/${created.body.id}`).expect(200);
    const merchants = await admin.get('/admin/merchants').expect(200);
    expect(merchants.body[0]).toMatchObject({
      name: 'Eve Chantelle',
      skuCount: 20,
      shipmentCount: 1,
    });

    // A second merchant cannot read it.
    const other = await prisma.merchant.create({ data: { name: 'Other brand' } });
    const { hashPassword } = await import('@shiplynow/db');
    await prisma.user.create({
      data: {
        email: 'other@brand.eg',
        name: 'Other',
        role: 'merchant',
        merchantId: other.id,
        passwordHash: await hashPassword(DEMO),
      },
    });
    const stranger = await agent('other@brand.eg');
    await stranger.get(`/merchant/manifests/${created.body.id}`).expect(404);
  });
});
