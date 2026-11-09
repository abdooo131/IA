import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { db, resetDb, signIn, startApp } from './helpers';
import { courier, network, scanBody, walk } from './parcel-fixtures';

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
  omar = await signIn(app, '01111111111', 'omar-pass-1');
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});
const http = () => request(app.getHttpServer());
const post = async (url: string, body: object, cookies = owner) => http().post(url).set('Cookie', cookies).send(body);
const parcel = async (address = 'شارع 9 المعادي الجديدة') =>
  (await post('/parcels', { merchantId: net.merchant.id, customerName: 'Sara', phone: '01001234567', address, size: 'small', cod: '100' })).body as { id: string; tracking: string };
const go = (tracking: string[], upTo: 'picked_up' | 'at_inbound' | 'sorted') => walk(post as never, { courier: omar, staff: owner }, { merchantId: net.merchant.id, facilityId: net.facility.id, courierId: omarId }, tracking, upTo);
const scan = (step: string, code: string, extra: object = {}) => post('/parcels/scan', scanBody(step, code, { siteId: net.facility.id, ...extra }));
const statusOf = async (id: string) => (await db.parcel.findUniqueOrThrow({ where: { id } })).status;

describe('inbound', () => {
  it('shows expected against received and makes a gap for a parcel that never arrived', async () => {
    const [a, b] = [await parcel(), await parcel()];
    const pickupId = await go([a.tracking, b.tracking], 'picked_up');
    expect((await scan('inbound', a.tracking)).body).toMatchObject({ ok: true, big: '1/2' });
    const view = (await http().get(`/parcels/facility/${net.facility.id}/inbound`).set('Cookie', owner)).body;
    expect(view.cars).toContainEqual(expect.objectContaining({ pickupId, courierId: omarId, expected: 2, received: 1 }));
    expect((await post(`/parcels/facility/${net.facility.id}/inbound/close`, { pickupId })).status).toBe(200);
    const gaps = (await http().get('/parcels/gaps?open=true').set('Cookie', owner)).body;
    expect(gaps).toEqual([expect.objectContaining({ kind: 'missing', parcelId: b.id, lastScanById: omarId, siteId: net.facility.id })]);
    const home = (await http().get('/me/home').set('Cookie', owner)).body;
    expect(home.attention).toContainEqual(expect.objectContaining({ app: 'shiply', text: 'home.parcelGaps', values: { count: 1 } }));
  });
});

describe('sorting and outbound', () => {
  it('refuses sorting before inbound and shows the destination hub after', async () => {
    const a = await parcel();
    await go([a.tracking], 'picked_up');
    expect((await scan('sorting', a.tracking)).body).toMatchObject({ ok: false, colour: 'red', reason: 'wrong_status' });
    await scan('inbound', a.tracking);
    expect((await scan('sorting', a.tracking)).body).toMatchObject({ ok: true, colour: 'green', big: 'MAA' });
    expect(await statusOf(a.id)).toBe('sorted');
  });

  it('refuses another hub parcel in a bag, and a full bag', async () => {
    const hub2 = (await post('/location/sites', { kind: 'last_mile_hub', code: 'DEG', nameEn: 'Degla hub', nameAr: 'مركز دجلة', sortingFacilityId: net.facility.id })).body;
    const z2 = (await post('/location/zones', { hubId: hub2.id, code: 'DEG-A', nameEn: 'Degla A', nameAr: 'دجلة أ' })).body;
    await http().put('/location/map/degla').set('Cookie', owner).send({ zoneId: z2.id, notServed: false });
    await http().put('/settings/parcels.bag_capacity').set('Cookie', owner).send({ value: 2 });
    const [a, b, c] = [await parcel(), await parcel(), await parcel()];
    const d = await parcel('دجلة المعادي');
    await go([a.tracking, b.tracking, c.tracking, d.tracking], 'sorted');
    expect((await scan('outbound', a.tracking, { bagSeal: 'SEAL1' })).body).toMatchObject({ ok: true, big: '1' });
    expect((await scan('outbound', d.tracking, { bagSeal: 'SEAL1' })).body).toMatchObject({ ok: false, reason: 'other_hub' });
    await scan('outbound', b.tracking, { bagSeal: 'SEAL1' });
    expect((await scan('outbound', c.tracking, { bagSeal: 'SEAL1' })).body).toMatchObject({ ok: false, reason: 'bag_full' });
    expect(await statusOf(c.id)).toBe('sorted');
    expect(await statusOf(a.id)).toBe('at_outbound');
  });
});

describe('bags and cars', () => {
  it('closes a bag once when two people close it together', async () => {
    const a = await parcel();
    await go([a.tracking], 'sorted');
    await scan('outbound', a.tracking, { bagSeal: 'SEAL9' });
    const [x, y] = await Promise.all([post('/parcels/bags/SEAL9/close', {}), post('/parcels/bags/SEAL9/close', {})]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
  });

  it('lets the car leave only with the right bag count, and puts its parcels in transit', async () => {
    const [a, b] = [await parcel(), await parcel()];
    await go([a.tracking, b.tracking], 'sorted');
    await scan('outbound', a.tracking, { bagSeal: 'S1' });
    await post('/parcels/bags/S1/close', {});
    expect((await post('/parcels/bags/single', { parcelId: b.id, seal: 'S2', siteId: net.facility.id })).status).toBe(201);
    const car = (await post('/parcels/cars', { fromSiteId: net.facility.id, toSiteId: net.hub.id, driverName: 'Hassan' })).body;
    expect((await scan('car_load', 'S1', { carId: car.id })).body).toMatchObject({ ok: true, big: '1' });
    expect((await scan('car_load', 'S2', { carId: car.id })).body).toMatchObject({ ok: true, big: '2' });
    const wrong = await post(`/parcels/cars/${car.id}/depart`, { driverCount: 3 });
    expect([wrong.status, wrong.body.error]).toEqual([409, 'count_mismatch']);
    expect(await statusOf(a.id)).toBe('at_outbound');
    expect((await post(`/parcels/cars/${car.id}/depart`, { driverCount: 2 })).status).toBe(200);
    expect([await statusOf(a.id), await statusOf(b.id)]).toEqual(['in_transit', 'in_transit']);
  });
});
