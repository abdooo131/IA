import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { db, resetDb, signIn, startApp } from './helpers';

let app: INestApplication;
let owner: string[];
beforeEach(async () => {
  await resetDb();
  app ??= await startApp();
  owner = await signIn(app, 'owner@test.local', 'owner-pass-1');
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});
const http = () => request(app.getHttpServer());
const post = (url: string, body: object, cookies = owner) => http().post(url).set('Cookie', cookies).send(body);

describe('location admin', () => {
  it('uses a taught name on the next address without a restart', async () => {
    expect((await post('/location/find', { address: 'fumfum st 3' })).body.area).toBeNull();
    expect((await post('/location/taught', { name: 'fumfum', placeId: 'maadi' })).status).toBe(201);
    expect((await post('/location/find', { address: 'fumfum st 3' })).body.area.id).toBe('maadi');
  });

  it('merges a place and moves everything that pointed at it', async () => {
    await post('/location/taught', { name: 'zahra land', placeId: 'zahraa-el-maadi' });
    await db.phoneMemory.create({ data: { phone: '+201000000001', placeId: 'zahraa-el-maadi', source: 'manual' } });
    const res = await post('/location/places/zahraa-el-maadi/merge', { intoId: 'maadi' });
    expect(res.status).toBe(200);
    expect(await db.taughtName.findFirst({ where: { name: 'zahra land' } })).toMatchObject({ placeId: 'maadi' });
    expect(await db.phoneMemory.findUnique({ where: { phone: '+201000000001' } })).toMatchObject({ placeId: 'maadi' });
    expect(await db.place.findUnique({ where: { id: 'zahraa-el-maadi' } })).toMatchObject({ active: false, mergedIntoId: 'maadi' });
    expect((await post('/location/find', { address: 'zahraa el maadi' })).body.area.id).toBe('maadi');
  });

  it('refuses a last mile hub without a sorting facility', async () => {
    const res = await post('/location/sites', { kind: 'last_mile_hub', code: 'NC', nameEn: 'Nasr City hub', nameAr: 'مركز مدينة نصر' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('hub_needs_facility');
  });

  it('shows the full chain on the map, and a gap when the facility is closed', async () => {
    const sf = (await post('/location/sites', { kind: 'sorting_facility', code: 'OBR', nameEn: 'Obour facility', nameAr: 'مركز فرز العبور' })).body;
    const hub = (await post('/location/sites', { kind: 'last_mile_hub', code: 'MAA', nameEn: 'Maadi hub', nameAr: 'مركز المعادي', sortingFacilityId: sf.id })).body;
    const zone = (await post('/location/zones', { hubId: hub.id, code: 'MAA-A', nameEn: 'Maadi A', nameAr: 'المعادي أ' })).body;
    expect((await http().put('/location/map/maadi').set('Cookie', owner).send({ zoneId: zone.id, notServed: false })).status).toBe(200);
    let row = (await http().get('/location/map?q=Maadi').set('Cookie', owner)).body.rows.find((r: { place: { id: string } }) => r.place.id === 'maadi');
    expect(row).toMatchObject({ zone: { code: 'MAA-A' }, hub: { code: 'MAA' }, facility: { code: 'OBR' } });
    expect(row.gap).toBeUndefined();
    await http().patch(`/location/sites/${sf.id}`).set('Cookie', owner).send({ active: false });
    row = (await http().get('/location/map?q=Maadi').set('Cookie', owner)).body.rows.find((r: { place: { id: string } }) => r.place.id === 'maadi');
    expect(row.gap).toBe('hub_without_facility');
    const other = (await http().get('/location/map?q=Zamalek').set('Cookie', owner)).body.rows.find((r: { place: { id: string } }) => r.place.id === 'zamalek');
    expect(other.gap).toBe('no_zone');
  });

  it('lets a viewer read but not change places', async () => {
    const viewer = await signIn(app, '01012345678', 'viewer-pass-1');
    expect((await http().get('/location/places?q=maadi').set('Cookie', viewer)).status).toBe(200);
    const res = await post('/location/places', { kind: 'neighbourhood', parentId: 'maadi', nameEn: 'Test', nameAr: 'تجربة' }, viewer);
    expect(res.status).toBe(403);
  });

  it('adds a new place that the engine finds at once', async () => {
    const res = await post('/location/places', { kind: 'neighbourhood', parentId: 'maadi', nameEn: 'Gardenia Maadi', nameAr: 'جاردينيا المعادي', names: ['gardenia'] });
    expect(res.status).toBe(201);
    expect((await post('/location/find', { address: 'villa 3 gardenia' })).body.area.id).toBe(res.body.id);
  });
});

describe('location admin review fixes', () => {
  it('refuses to merge a place into its own child, or to make a parent loop', async () => {
    const res = await post('/location/places/maadi/merge', { intoId: 'new-maadi' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('merge_into_child');
    const loop = await http().patch('/location/places/maadi').set('Cookie', owner).send({ parentId: 'new-maadi' });
    expect(loop.status).toBe(400);
    expect(loop.body.error).toBe('parent_loop');
  });

  it('accepts a large pasted file in the finder', async () => {
    const text = Array.from({ length: 6000 }, (_, i) => `${i + 1}. شارع ${i} المعادي الجديدة القاهرة`).join('\n');
    expect(text.length).toBeGreaterThan(200_000);
    const res = await post('/location/find/bulk', { text });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(6000);
  });
});
