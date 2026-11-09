import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { LocationService } from '../src/location';
import { ParcelsService } from '../src/parcels';
import { isTracking, newTracking } from '../src/parcels/tracking';
import { processDue } from '../src/platform/events';
import { db, resetDb, signIn, startApp } from './helpers';
import { network } from './parcel-fixtures';

let app: INestApplication;
let owner: string[];
let net: Awaited<ReturnType<typeof network>>;
beforeEach(async () => {
  await resetDb();
  app ??= await startApp();
  owner = await signIn(app, 'owner@test.local', 'owner-pass-1');
  net = await network(app, owner);
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});
const http = () => request(app.getHttpServer());
const create = (address: string, cookies = owner) =>
  http().post('/parcels').set('Cookie', cookies).send({ merchantId: net.merchant.id, customerName: 'Sara', phone: '0100 123 4567', address, size: 'small', cod: '250', openPackage: false });

describe('parcels', () => {
  it('routes and prices a parcel with a clear address', async () => {
    const res = await create('شارع 9 المعادي الجديدة');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ placeId: 'new-maadi', zoneId: net.zone.id, hubId: net.hub.id, facilityId: net.facility.id, originFacilityId: net.facility.id, price: 4500, codAmount: 25000, phone: '+201001234567', status: 'created' });
    expect(isTracking(res.body.tracking)).toBe(true);
    const record = (await http().get(`/parcels/${res.body.tracking}`).set('Cookie', owner)).body;
    expect(record.events.map((e: { status: string }) => e.status)).toEqual(['created']);
  });

  it('waits for an unclear address and gets its route and price once the area is picked', async () => {
    const p = (await create('الحي السابع')).body;
    expect(p).toMatchObject({ placeId: null, price: null, zoneId: null });
    const ownerId = (await db.user.findFirstOrThrow({ where: { email: 'owner@test.local' } })).id;
    await app.get(LocationService).pick(p.decisionId, 'degla', ownerId);
    await processDue(db);
    expect(await db.parcel.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ placeId: 'degla', zoneId: net.zone.id, price: 4500 });
  });

  it('only moves along the allowed statuses, and cancels only before pickup', async () => {
    const a = (await create('شارع 9 المعادي الجديدة')).body;
    const parcels = app.get(ParcelsService);
    await expect(db.$transaction((tx) => parcels.move(tx, a.id, 'delivered', { userId: null }))).rejects.toMatchObject({ response: { error: 'wrong_status' } });
    await db.$transaction((tx) => parcels.move(tx, a.id, 'picked_up', { userId: null }));
    expect((await http().post(`/parcels/${a.id}/cancel`).set('Cookie', owner)).status).toBe(409);
    const b = (await create('شارع 9 المعادي الجديدة')).body;
    expect((await http().post(`/parcels/${b.id}/cancel`).set('Cookie', owner)).status).toBe(200);
  });

  it('refuses a viewer and a bad phone', async () => {
    const viewer = await signIn(app, '01012345678', 'viewer-pass-1');
    expect((await create('المعادي', viewer)).status).toBe(403);
    const bad = await http().post('/parcels').set('Cookie', owner).send({ merchantId: net.merchant.id, customerName: 'S', phone: '123', address: 'المعادي', size: 'small', cod: '0' });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain('phone');
  });
});

describe('tracking numbers', () => {
  it('carries a check digit that catches one changed digit', () => {
    const t = newTracking();
    expect(t).toMatch(/^SP\d{10}$/);
    expect(isTracking(t)).toBe(true);
    const d = Number(t[5]);
    expect(isTracking(`${t.slice(0, 5)}${(d + 1) % 10}${t.slice(6)}`)).toBe(false);
  });
});
