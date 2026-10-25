import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, FixedClock, resetAndSeed } from './helpers';

const NOON_CAIRO = new Date('2026-01-14T10:00:00Z');

describe('admin', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let stores: Map<string, string>;
  let admin: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ clock: new FixedClock(NOON_CAIRO) }));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    ({ stores } = await resetAndSeed(prisma));
    admin = request.agent(app.getHttpServer());
    await admin
      .post('/auth/login')
      .send({ email: 'admin@test.eg', password: 'admin-password-1' })
      .expect(200);
  });

  it('is closed to store staff and riders', async () => {
    const staff = request.agent(app.getHttpServer());
    await staff
      .post('/auth/login')
      .send({ email: 'staff.newcairo@shiplynow.local', password: 'demo-password-1' })
      .expect(200);
    for (const path of ['/admin/dark-stores', '/admin/skus', '/admin/stock', '/admin/zones']) {
      await staff.get(path).expect(403);
    }
  });

  it('lists dark stores with stock totals, hours and live status', async () => {
    const res = await admin.get('/admin/dark-stores').expect(200);
    expect(res.body.map((s: { code: string }) => s.code)).toEqual(['MAA', 'NCR', 'ZAM']);
    const zam = res.body[2];
    expect(zam).toMatchObject({
      zoneCount: 1,
      skusInStock: 15,
      unitsReserved: 0,
      openNow: true,
      capacityPerHour: 20,
      ordersLastHour: 0,
    });
    expect(zam.hours).toHaveLength(7);
    expect(zam.unitsOnHand).toBeGreaterThan(0);
  });

  it('lists SKUs and stock with availability and low stock flags', async () => {
    const skus = await admin.get('/admin/skus').expect(200);
    expect(skus.body).toHaveLength(20);
    expect(skus.body[0]).toMatchObject({ sku: 'EC-001', merchant: { name: 'Eve Chantelle' } });

    const stock = await admin
      .get('/admin/stock')
      .query({ darkStoreId: stores.get('ZAM') })
      .expect(200);
    expect(stock.body).toHaveLength(15);
    expect(
      stock.body.every((r: { available: number; onHand: number }) => r.available === r.onHand),
    ).toBe(true);

    await prisma.setting.create({ data: { key: 'stock.low_stock_threshold', value: 1000 } });
    const low = await admin.get('/admin/stock').expect(200);
    expect(low.body.every((r: { lowStock: boolean }) => r.lowStock)).toBe(true);
  });

  it('updates opening hours, audited, and rejects a bad week', async () => {
    const id = stores.get('MAA')!;
    const week = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      opensMinute: 9 * 60,
      closesMinute: 26 * 60,
      isClosed: weekday === 5,
    }));
    await admin.put(`/admin/dark-stores/${id}/hours`).send(week).expect(200);
    const saved = await prisma.storeHours.findMany({
      where: { darkStoreId: id },
      orderBy: { weekday: 'asc' },
    });
    expect(saved[5]).toMatchObject({ isClosed: true, closesMinute: 1560 });
    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'dark_store.hours_update' },
    });
    expect((entry.before as { opensMinute: number }[])[0]!.opensMinute).toBe(600);
    expect((entry.after as { opensMinute: number }[])[0]!.opensMinute).toBe(540);

    await admin.put(`/admin/dark-stores/${id}/hours`).send(week.slice(0, 3)).expect(400);
  });

  it('redraws a zone border, audited with the old and new shape', async () => {
    const zones = await admin.get('/admin/zones').expect(200);
    const zam = zones.body.find((z: { code: string }) => z.code === 'ZAM-ALL');
    const area = {
      type: 'Polygon',
      coordinates: [
        [
          [31.21, 30.04],
          [31.23, 30.04],
          [31.23, 30.08],
          [31.21, 30.08],
          [31.21, 30.04],
        ],
      ],
    };
    await admin.put(`/admin/zones/${zam.id}/area`).send({ area }).expect(200);
    const after = await admin.get('/admin/zones').expect(200);
    expect(
      after.body.find((z: { id: string }) => z.id === zam.id).area.coordinates[0][0],
    ).toHaveLength(5);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'zone.area_update' } });
    expect(entry.before).toMatchObject({ area: { type: 'MultiPolygon' } });
    expect(entry.after).toMatchObject({ area });
  });

  it('refuses a self crossing border and a ring outside Egypt', async () => {
    const zones = await admin.get('/admin/zones').expect(200);
    const id = zones.body[0].id;
    const bowtie = [
      [31.2, 30.0],
      [31.3, 30.1],
      [31.3, 30.0],
      [31.2, 30.1],
      [31.2, 30.0],
    ];
    const res = await admin
      .put(`/admin/zones/${id}/area`)
      .send({ area: { type: 'Polygon', coordinates: [bowtie] } })
      .expect(400);
    expect(res.body.error).toBe('zone_geometry_invalid');
    await admin
      .put(`/admin/zones/${id}/area`)
      .send({ area: { type: 'Polygon', coordinates: [bowtie.map(([x, y]) => [x! + 20, y!])] } })
      .expect(400);
  });

  it('creates a zone, refuses a duplicate code, and can switch a zone off', async () => {
    const body = {
      darkStoreId: stores.get('NCR'),
      code: 'ncr-1s',
      nameEn: 'First Settlement',
      nameAr: 'التجمع الأول',
      area: {
        type: 'Polygon',
        coordinates: [
          [
            [31.38, 30.06],
            [31.44, 30.06],
            [31.44, 30.09],
            [31.38, 30.09],
            [31.38, 30.06],
          ],
        ],
      },
    };
    const created = await admin.post('/admin/zones').send(body).expect(201);
    expect((await prisma.zone.findUniqueOrThrow({ where: { id: created.body.id } })).code).toBe(
      'NCR-1S',
    );
    await admin.post('/admin/zones').send(body).expect(409);

    await admin.patch(`/admin/zones/${created.body.id}`).send({ isActive: false }).expect(200);
    const areas = await request(app.getHttpServer()).get('/coverage/areas').expect(200);
    expect(areas.body.map((a: { code: string }) => a.code)).not.toContain('NCR-1S');
  });
});
