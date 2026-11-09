import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { db, resetDb, signIn, startApp } from './helpers';
import { courier, network, scanBody } from './parcel-fixtures';

let app: INestApplication;
let owner: string[];
let omar: string[];
let omarId: string;
let net: Awaited<ReturnType<typeof network>>;
beforeEach(async () => {
  await resetDb();
  app ??= await startApp();
  owner = await signIn(app, 'owner@test.local', 'owner-pass-1');
  net = await network(app, owner);
  omarId = (await courier('omar', '01111111111')).id;
  await courier('ali', '01222222222');
  omar = await signIn(app, '01111111111', 'omar-pass-1');
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});
const http = () => request(app.getHttpServer());
const post = (url: string, body: object, cookies = owner) => http().post(url).set('Cookie', cookies).send(body);
const newParcel = async (merchantId = net.merchant.id) =>
  (await post('/parcels', { merchantId, customerName: 'Sara', phone: '01001234567', address: 'شارع 9 المعادي الجديدة', size: 'small', cod: '100' })).body;
async function assignedPickup() {
  const p = (await post('/parcels/pickups', { merchantId: net.merchant.id, date: '2026-11-10' })).body;
  expect((await post(`/parcels/pickups/${p.id}/assign`, { courierId: omarId })).status).toBe(200);
  return p;
}

describe('scans', () => {
  it('answers a resent scan with the first answer and changes nothing twice', async () => {
    const parcel = await newParcel();
    const pickup = await assignedPickup();
    const body = scanBody('pickup', parcel.tracking, { pickupId: pickup.id });
    const first = await post('/parcels/scan', body, omar);
    const again = await post('/parcels/scan', body, omar);
    expect(first.body).toMatchObject({ ok: true, colour: 'green' });
    expect(again.body).toEqual(first.body);
    expect(await db.scan.count()).toBe(1);
    expect(await db.parcelEvent.count({ where: { parcelId: parcel.id, status: 'picked_up' } })).toBe(1);
  });

  it('answers red for an unknown code and for another merchant parcel, and stores the scan', async () => {
    const other = await db.merchant.create({ data: { code: 'ZED', name: 'Zed', contactName: 'Z', contactPhone: '+201099999999', services: ['shiply'], status: 'approved' } });
    const theirs = await db.parcel.create({ data: { tracking: 'SP0000000000', merchantId: other.id, customerName: 'x', phone: '+201001234567', addressText: 'x', size: 'small', createdById: omarId } });
    const pickup = await assignedPickup();
    expect((await post('/parcels/scan', scanBody('pickup', 'SP123'), omar)).body).toMatchObject({ ok: false, colour: 'red', reason: 'not_found' });
    expect((await post('/parcels/scan', scanBody('pickup', theirs.tracking, { pickupId: pickup.id }), omar)).body).toMatchObject({ ok: false, reason: 'other_merchant' });
    expect((await db.parcel.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe('created');
    expect(await db.scan.count({ where: { ok: false } })).toBe(2);
  });

  it('moves a picked parcel to picked up and the pickup to on the way', async () => {
    const parcel = await newParcel();
    const pickup = await assignedPickup();
    await post('/parcels/scan', scanBody('pickup', parcel.tracking, { pickupId: pickup.id }), omar);
    expect(await db.parcel.findUniqueOrThrow({ where: { id: parcel.id } })).toMatchObject({ status: 'picked_up', pickupId: pickup.id });
    expect((await db.pickup.findUniqueOrThrow({ where: { id: pickup.id } })).status).toBe('on_the_way');
  });
});

describe('pickups', () => {
  it('shows a courier only his own pickups, and refuses his scan on another courier pickup', async () => {
    const mine = await assignedPickup();
    const p2 = (await post('/parcels/pickups', { merchantId: net.merchant.id, date: '2026-11-10' })).body;
    const ali = await db.user.findFirstOrThrow({ where: { mobile: '+201222222222' } });
    await post(`/parcels/pickups/${p2.id}/assign`, { courierId: ali.id });
    const list = (await http().get('/parcels/me/pickups?date=2026-11-10').set('Cookie', omar)).body;
    expect(list.map((p: { id: string }) => p.id)).toEqual([mine.id]);
    const parcel = await newParcel();
    expect((await post('/parcels/scan', scanBody('pickup', parcel.tracking, { pickupId: p2.id }), omar)).body).toMatchObject({ ok: false, reason: 'not_your_pickup' });
    expect((await http().get('/parcels/pickups').set('Cookie', omar)).status).toBe(403);
  });

  it('makes the day pickups from recurring ones once, even if run twice', async () => {
    // 2026-11-10 is a Tuesday (2)
    expect((await post('/parcels/pickups/recurring', { merchantId: net.merchant.id, weekdays: [2, 4] })).status).toBe(201);
    await post('/parcels/pickups/recurring', { merchantId: net.merchant.id, weekdays: [5] });
    await post('/parcels/pickups/make-day', { date: '2026-11-10' });
    await post('/parcels/pickups/make-day', { date: '2026-11-10' });
    expect(await db.pickup.count({ where: { date: new Date('2026-11-10') } })).toBe(1);
  });
});
