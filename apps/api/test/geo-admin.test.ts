import type { INestApplication } from '@nestjs/common';
import { forgetAreaNames, loadBaseAreas, type OsmElement } from '@shiplynow/db';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GeoImportService, Overpass } from '../src/coverage/geo-import.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetAndSeed } from './helpers';

/** Answers every places query with one New Cairo neighbourhood, and streets with nothing. */
class FakeOverpass extends Overpass {
  queries: string[] = [];
  async query(query: string): Promise<OsmElement[]> {
    this.queries.push(query);
    if (!query.includes('place')) return [];
    return [
      {
        type: 'node',
        id: 77,
        lat: 30.03,
        lon: 31.47,
        tags: { place: 'neighbourhood', name: 'حي الياسمين', 'name:en': 'Yasmeen Quarter' },
      },
    ];
  }
}

describe('admin area map', () => {
  const overpass = new FakeOverpass();
  let app: INestApplication;
  let prisma: PrismaService;
  let imports: GeoImportService;
  let admin: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ overpass }));
    imports = app.get(GeoImportService);
    imports.pauseMs = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetAndSeed(prisma);
    await loadBaseAreas(prisma);
    forgetAreaNames();
    admin = request.agent(app.getHttpServer());
    await admin
      .post('/auth/login')
      .send({ email: 'admin@test.eg', password: 'admin-password-1' })
      .expect(200);
  });

  it('imports neighbourhoods in the background and the engine then knows them', async () => {
    const before = await admin.get('/admin/geo').expect(200);
    expect(before.body.areasByLevel['2']).toBeGreaterThan(0);
    expect(before.body.import).toMatchObject({ running: false, kind: null });

    const started = await admin.post('/admin/geo/import').send({ kind: 'places' }).expect(201);
    expect(started.body).toMatchObject({ kind: 'places', running: true });
    await admin.post('/admin/geo/import').send({ kind: 'streets' }).expect(409);
    await imports.idle();

    const after = await admin.get('/admin/geo').expect(200);
    expect(after.body.import).toMatchObject({ running: false, found: 1, saved: 1, error: null });
    expect(after.body.areasByLevel['3']).toBe(1);

    const resolved = await admin
      .post('/admin/geo/resolve')
      .send({ address: 'Villa 4, Yasmeen Quarter, New Cairo' })
      .expect(201);
    expect(resolved.body.chain.map((s: { nameEn: string }) => s.nameEn)).toContain(
      'Yasmeen Quarter',
    );
  });

  it('fetches streets one district at a time', async () => {
    await admin.post('/admin/geo/import').send({ kind: 'streets' }).expect(201);
    await imports.idle();
    const status = (await admin.get('/admin/geo').expect(200)).body.import;
    expect(status.total).toBeGreaterThan(10);
    expect(status).toMatchObject({ running: false, failed: [] });
    expect(status.done).toBe(status.total);
  });

  it('adds names by hand and from suggestions', async () => {
    const found = await admin.get('/admin/geo/areas').query({ q: 'new cairo' }).expect(200);
    const area = found.body[0];
    expect(area).toMatchObject({ level: 2, nameEn: 'New Cairo' });
    await admin
      .post(`/admin/geo/areas/${area.id}/names`)
      .send({ name: 'Tagamoa Khames' })
      .expect(201);
    const named = await admin
      .post('/admin/geo/resolve')
      .send({ address: 'Building 5, Tagamoa Khames' })
      .expect(201);
    expect(named.body.chain.at(-1)).toMatchObject({ nameEn: 'New Cairo' });

    const s = await prisma.geoSuggestion.create({
      data: { phrase: 'golden square', areaId: area.id, sampleAddress: 'x, golden square' },
    });
    const list = await admin.get('/admin/geo/suggestions').expect(200);
    expect(list.body).toEqual([expect.objectContaining({ phrase: 'golden square' })]);
    await admin.post(`/admin/geo/suggestions/${s.id}`).send({ approve: true }).expect(201);
    await admin.post(`/admin/geo/suggestions/${s.id}`).send({ approve: false }).expect(409);
    expect((await admin.get('/admin/geo/suggestions').expect(200)).body).toEqual([]);
  });

  it('builds zones from areas on the map: assign, carve out, refuse hubs, audit', async () => {
    await admin.post('/admin/geo/import').send({ kind: 'places' }).expect(201);
    await imports.idle();
    const newCairo = await prisma.geoArea.findFirstOrThrow({
      where: { level: 2, nameEn: 'New Cairo', isActive: true },
    });
    const quarter = await prisma.geoArea.findFirstOrThrow({ where: { nameEn: 'Yasmeen Quarter' } });
    const ncr = await prisma.zone.findFirstOrThrow({ where: { code: 'NCR-5S' } });
    const maa = await prisma.zone.findFirstOrThrow({ where: { code: 'MAA-ALL' } });
    // Start from a clean slate: the outlines move ran with the import.
    await prisma.storeArea.deleteMany({});

    await admin.post(`/admin/zones/${ncr.id}/areas`).send({ areaId: newCairo.id }).expect(201);
    // Another store cannot take a neighbourhood New Cairo's store serves, unless moved.
    const refused = await admin
      .post(`/admin/zones/${maa.id}/areas`)
      .send({ areaId: quarter.id })
      .expect(409);
    expect(refused.body.error).toBe('area_served_by_other_store');
    await admin
      .post(`/admin/zones/${maa.id}/areas`)
      .send({ areaId: quarter.id, move: true })
      .expect(201);
    // A zone built from areas is not drawn by hand any more.
    const drawn = await admin
      .put(`/admin/zones/${ncr.id}/area`)
      .send({
        area: {
          type: 'Polygon',
          coordinates: [
            [
              [31.4, 30.0],
              [31.5, 30.0],
              [31.5, 30.1],
              [31.4, 30.0],
            ],
          ],
        },
      })
      .expect(409);
    expect(drawn.body.error).toBe('zone_uses_areas');

    const map = await admin
      .get('/admin/zones/areas')
      .query({ districtId: newCairo.id, levels: '2,3' })
      .expect(200);
    const owners = Object.fromEntries(
      map.body.areas.map((a: { id: string; owner: unknown }) => [a.id, a.owner]),
    );
    expect(owners[newCairo.id]).toMatchObject({ zoneId: ncr.id, inherited: false });
    expect(owners[quarter.id]).toMatchObject({ zoneId: maa.id, inherited: false });
    expect(map.body.areas[0].geometry.type).toMatch(/Polygon/);
    // A zone's own areas, for its list on the zone screen.
    const own = await admin
      .get('/admin/zones/areas')
      .query({ zoneId: maa.id, levels: '2,3,4' })
      .expect(200);
    expect(own.body.areas.map((a: { id: string }) => a.id)).toEqual([quarter.id]);

    await admin.post(`/admin/zones/areas/${quarter.id}/exclude`).send({}).expect(201);
    await admin.delete(`/admin/zones/areas/${quarter.id}`).expect(200);
    const decided = await request(app.getHttpServer())
      .get('/coverage')
      .query({ areaId: quarter.id })
      .expect(200);
    expect(decided.body).toMatchObject({ darkStore: { code: 'NCR' } });

    const history = await prisma.auditLog.findMany({
      where: { entityType: 'geo_area', entityId: quarter.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.map((h) => h.action)).toEqual([
      'store_area.assign',
      'store_area.exclude',
      'store_area.unassign',
    ]);
    expect((await admin.get('/admin/zones/areas/review').expect(200)).body).toEqual([]);
  });
});
