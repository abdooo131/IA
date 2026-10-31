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
});
