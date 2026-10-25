import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays, cairoDay, cairoDayStart } from '@shiplynow/shared';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, FixedClock, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';
const NOON_CAIRO = new Date('2026-01-14T10:00:00Z');
const NEW_CAIRO = { latitude: 30.03, longitude: 31.47 };
// Orders are stamped with the real time, so ranges use the real Cairo day.
const today = cairoDay(new Date());
const tomorrow = addDays(today, 1);

describe('admin dashboard, settings, users and catalog', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let stores: Map<string, string>;
  let admin: ReturnType<typeof request.agent>;
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
    ({ stores } = await resetAndSeed(prisma));
    admin = await agent('admin@test.eg', 'admin-password-1');
  });

  const placeOrder = async () => {
    const merchant = await agent('merchant@evechantelle.example');
    const sku = await prisma.sku.findFirstOrThrow({ where: { sku: 'EC-001' } });
    const res = await merchant
      .post('/merchant/orders')
      .send({
        customerName: '=Sara Ali',
        customerPhone: '01012345678',
        addressText: 'Villa 12, "South" 90th St',
        ...NEW_CAIRO,
        paymentMethod: 'cod',
        deliveryFeePiastres: 3000,
        items: [{ skuId: sku.id, quantity: 2 }],
      })
      .expect(201);
    return res.body as { id: string; number: string };
  };

  it('keeps every new endpoint for admins only', async () => {
    const staff = await agent('staff.newcairo@shiplynow.local');
    for (const path of [
      '/admin/kpis',
      '/admin/live',
      '/admin/settings',
      '/admin/audit',
      '/admin/users',
      '/admin/orders/export.csv',
    ])
      await staff.get(path).expect(403);
    await staff.post('/admin/skus').send({}).expect(403);
  });

  it('reports KPIs for a Cairo day range and the live board', async () => {
    await placeOrder();
    const kpis = await admin.get(`/admin/kpis?from=${today}&to=${today}`).expect(200);
    expect(kpis.body.from).toBe(cairoDayStart(today).toISOString());
    expect(kpis.body.to).toBe(cairoDayStart(tomorrow).toISOString());
    expect(kpis.body.totals).toMatchObject({ orders: 1, active: 1, delivered: 0 });
    expect(kpis.body.perStore[0].darkStore.code).toBe('NCR');

    const empty = await admin.get(`/admin/kpis?from=${tomorrow}&to=${tomorrow}`).expect(200);
    expect(empty.body.totals.orders).toBe(0);
    await admin.get(`/admin/kpis?from=${tomorrow}&to=${today}`).expect(400);

    const live = await admin.get('/admin/live').expect(200);
    const ncr = live.body.stores.find(
      (s: { darkStore: { code: string } }) => s.darkStore.code === 'NCR',
    );
    expect(ncr).toMatchObject({ active: 1, byStatus: { new: 1 }, riders: 1, ridersOut: 0 });
  });

  it('exports orders as a CSV Excel can open safely', async () => {
    const order = await placeOrder();
    const res = await admin.get(`/admin/orders/export.csv?from=${today}&to=${today}`).expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const text = res.text;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const [header, row] = text.slice(1).split('\r\n');
    expect(header!.split(',')[0]).toBe('number');
    expect(row).toContain(order.number);
    expect(row).toContain("'=Sara Ali");
    expect(row).toContain('"Villa 12, ""South"" 90th St"');
    expect(row).toContain(',EC-001 x2');
  });

  it('edits settings globally and per store, with an audit trail', async () => {
    const ncr = stores.get('NCR')!;
    await admin.put('/admin/settings').send({ key: 'sla.pick_minutes', value: 15 }).expect(200);
    const res = await admin
      .put('/admin/settings')
      .send({ key: 'sla.pick_minutes', scope: ncr, value: 8 })
      .expect(200);
    expect(
      res.body.settings.find((s: { key: string }) => s.key === 'sla.pick_minutes'),
    ).toMatchObject({
      global: 15,
      overrides: [{ darkStoreId: ncr, value: 8 }],
    });
    await admin.put('/admin/settings').send({ key: 'nope', value: 1 }).expect(400);
    await admin
      .put('/admin/settings')
      .send({ key: 'delivery.max_orders_per_trip', value: 40 })
      .expect(400);

    const audit = await admin.get('/admin/audit?entityType=setting').expect(200);
    expect(audit.body.rows[0]).toMatchObject({
      action: 'settings.update',
      entityId: `sla.pick_minutes@${ncr}`,
      after: { value: 8 },
      actor: { email: 'admin@test.eg' },
    });
  });

  it('creates staff and riders who can sign in, and locks them out when disabled', async () => {
    const ncr = stores.get('NCR')!;
    const created = await admin
      .post('/admin/users')
      .send({
        email: 'New.Rider@Shiply.eg',
        name: 'New Rider',
        phone: '0111 222 3333',
        role: 'rider',
        password: 'rider-password-1',
        darkStoreId: ncr,
        badgeCode: 'rdr-0100',
      })
      .expect(201);
    const list = await admin.get('/admin/users?role=rider').expect(200);
    expect(list.body.find((u: { id: string }) => u.id === created.body.id)).toMatchObject({
      email: 'new.rider@shiply.eg',
      phone: '+201112223333',
      badgeCode: 'RDR-0100',
    });

    const rider = await agent('new.rider@shiply.eg', 'rider-password-1');
    await rider.get('/rider/me').expect(200);

    await admin.patch(`/admin/users/${created.body.id}`).send({ isActive: false }).expect(200);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'new.rider@shiply.eg', password: 'rider-password-1' })
      .expect(401);

    await admin
      .post('/admin/users')
      .send({ email: 'x@y.eg', name: 'No Store', role: 'store_staff', password: 'long-password-1' })
      .expect(400)
      .expect((r) => expect(r.body.error).toBe('dark_store_required'));
    await admin
      .post(`/admin/users/${created.body.id}/password`)
      .send({ password: 'short' })
      .expect(400);
  });

  it('adds merchants and products, and imports a product file', async () => {
    const merchant = await admin
      .post('/admin/merchants')
      .send({ name: 'Nour Cosmetics', contactPhone: '01223334444' })
      .expect(201);
    await admin
      .post('/admin/skus')
      .send({
        merchantId: merchant.body.id,
        sku: 'NC-1',
        barcode: '6221000000017',
        titleEn: 'Lip oil',
        titleAr: 'زيت شفايف',
        pricePiastres: 25000,
      })
      .expect(201);

    const bad = await admin
      .post('/admin/skus/import')
      .send({
        merchantId: merchant.body.id,
        rows: [
          { sku: 'NC-2', title_en: 'Blush', price_egp: '199' },
          { sku: 'NC-3', title_en: 'Bad price', price_egp: 'abc' },
        ],
      })
      .expect(201);
    expect(bad.body.errors).toEqual([
      { row: 3, sku: 'NC-3', error: expect.stringContaining('price_egp') },
    ]);
    expect(await prisma.sku.count({ where: { merchantId: merchant.body.id } })).toBe(1);

    const ok = await admin
      .post('/admin/skus/import')
      .send({
        merchantId: merchant.body.id,
        rows: [
          {
            sku: 'NC-1',
            title_en: 'Lip oil',
            title_ar: 'زيت شفايف',
            price_egp: '275.50',
            barcode: '6221000000017',
          },
          { sku: 'NC-2', title_en: 'Blush', price_egp: '199' },
        ],
      })
      .expect(201);
    expect(ok.body).toEqual({ created: 1, updated: 1, unchanged: 0, errors: [] });
    expect((await prisma.sku.findFirstOrThrow({ where: { sku: 'NC-1' } })).pricePiastres).toBe(
      27550,
    );
  });
});
