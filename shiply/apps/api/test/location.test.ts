import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { LocationService } from '../src/location';
import { db, resetDb, signIn, startApp } from './helpers';

let app: INestApplication;
let location: LocationService;
beforeEach(async () => {
  await resetDb();
  app ??= await startApp();
  location = app.get(LocationService);
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});
const http = () => request(app.getHttpServer());
const resolve = (text: string, phone?: string, refId = 'p1') =>
  db.$transaction((tx) => location.resolve(tx, { service: 'shiply', refType: 'parcel', refId, text, phone }));

describe('location', () => {
  it('places a clear address and queues nothing', async () => {
    const r = await resolve('شارع 9 المعادي الجديدة');
    expect(r).toMatchObject({ status: 'sure', placeId: 'new-maadi', method: 'engine' });
    const cookies = await signIn(app, 'owner@test.local', 'owner-pass-1');
    expect((await http().get('/location/queue').set('Cookie', cookies)).body.rows).toHaveLength(0);
  });

  it('queues an unclear address with its candidates, and a pick remembers the phone', async () => {
    const r = await resolve('الحي السابع', '01012345678');
    expect(r.status).toBe('unsure');
    const cookies = await signIn(app, 'owner@test.local', 'owner-pass-1');
    const queue = await http().get('/location/queue').set('Cookie', cookies);
    expect(queue.body.rows).toHaveLength(1);
    expect(queue.body.rows[0].candidates).toHaveLength(2);
    const pick = await http().post(`/location/queue/${r.decisionId}/pick`).set('Cookie', cookies).send({ placeId: 'nasr-city-hay-7' });
    expect(pick.status).toBe(200);
    expect(await db.phoneMemory.findUnique({ where: { phone: '+201012345678' } })).toMatchObject({ placeId: 'nasr-city-hay-7' });
    expect(await db.outboxEvent.count({ where: { type: 'location.resolved' } })).toBe(1);
    const next = await resolve('near the mosque', '٠١٠١٢٣٤٥٦٧٨', 'p2');
    expect(next).toMatchObject({ method: 'phone_memory', placeId: 'nasr-city-hay-7' });
  });

  it('lets only one of two people resolve the same address', async () => {
    const r = await resolve('الحي السابع');
    const cookies = await signIn(app, 'owner@test.local', 'owner-pass-1');
    const send = () => http().post(`/location/queue/${r.decisionId}/pick`).set('Cookie', cookies).send({ placeId: 'nasr-city-hay-7' });
    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('refuses a pick from someone who can only view', async () => {
    const r = await resolve('الحي السابع');
    const cookies = await signIn(app, '01012345678', 'viewer-pass-1');
    const res = await http().post(`/location/queue/${r.decisionId}/pick`).set('Cookie', cookies).send({ placeId: 'nasr-city-hay-7' });
    expect(res.status).toBe(403);
  });

  it('runs the finder on a pasted list', async () => {
    const cookies = await signIn(app, 'owner@test.local', 'owner-pass-1');
    const res = await http()
      .post('/location/find/bulk')
      .set('Cookie', cookies)
      .send({ text: '1. Behind the bank, Nasr City, Cairo\n2. Near the station, Tanta, Gharbia' });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);
    expect(res.body.results[0].area.id).toBe('nasr-city');
  });

  it('shows waiting addresses on Home', async () => {
    await resolve('الحي السابع');
    const cookies = await signIn(app, 'owner@test.local', 'owner-pass-1');
    const home = await http().get('/me/home').set('Cookie', cookies);
    expect(home.body.attention).toContainEqual(expect.objectContaining({ app: 'location', text: 'home.locationWaiting', values: { count: 1 } }));
    expect(home.body.tiles.find((t: { app: string }) => t.app === 'location').count).toBe(1);
  });
});

describe('phone memory and a new address', () => {
  it('lets a clear new address win over the remembered area, and updates the memory', async () => {
    await db.phoneMemory.create({ data: { phone: '+201012345678', placeId: 'zamalek', source: 'manual' } });
    const moved = await resolve('شارع 9 المعادي الجديدة', '01012345678');
    expect(moved).toMatchObject({ method: 'engine', placeId: 'new-maadi' });
    expect((await db.phoneMemory.findUniqueOrThrow({ where: { phone: '+201012345678' } })).placeId).toBe('new-maadi');
  });

  it('keeps the remembered area when the address only names a bigger area around it', async () => {
    await db.phoneMemory.create({ data: { phone: '+201012345678', placeId: 'degla', source: 'manual' } });
    expect(await resolve('المعادي', '01012345678')).toMatchObject({ method: 'phone_memory', placeId: 'degla' });
  });
});
