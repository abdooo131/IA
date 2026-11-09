import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { WalletsService } from '../src/money';
import { processDue } from '../src/platform/events';
import { db, resetDb, signIn, startApp } from './helpers';
import { courier, network, scanBody, walk } from './parcel-fixtures';

let app: INestApplication;
let owner: string[];
let omar: string[];
let omarId: string;
let aliId: string;
let net: Awaited<ReturnType<typeof network>>;
beforeEach(async () => {
  await resetDb();
  app ??= await startApp();
  owner = await signIn(app, 'owner@test.local', 'owner-pass-1');
  net = await network(app, owner);
  omarId = (await courier('omar', '01111111111')).id;
  aliId = (await courier('ali', '01222222222')).id;
  omar = await signIn(app, '01111111111', 'omar-pass-1');
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});
const http = () => request(app.getHttpServer());
const post = async (url: string, body: object, cookies = owner) => http().post(url).set('Cookie', cookies).send(body);
const parcel = async () => (await post('/parcels', { merchantId: net.merchant.id, customerName: 'Sara', phone: '01001234567', address: 'شارع 9 المعادي الجديدة', size: 'small', cod: '100' })).body as { id: string; tracking: string };
const scanAt = (siteId: string, step: string, code: string, extra: object = {}) => post('/parcels/scan', scanBody(step, code, { siteId, ...extra }));
const statusOf = async (id: string) => (await db.parcel.findUniqueOrThrow({ where: { id } })).status;

/** Parcels from the merchant to the hub, in one bag on one car. */
async function toHub(n: number, seal = 'S1') {
  const ps = [];
  for (let i = 0; i < n; i++) ps.push(await parcel());
  await walk(post as never, { courier: omar, staff: owner }, { merchantId: net.merchant.id, facilityId: net.facility.id, courierId: omarId }, ps.map((p) => p.tracking), 'sorted');
  for (const p of ps) await scanAt(net.facility.id, 'outbound', p.tracking, { bagSeal: seal });
  await post(`/parcels/bags/${seal}/close`, {});
  const car = (await post('/parcels/cars', { fromSiteId: net.facility.id, toSiteId: net.hub.id, driverName: 'Hassan' })).body;
  await scanAt(net.facility.id, 'car_load', seal, { carId: car.id });
  await post(`/parcels/cars/${car.id}/depart`, { driverCount: 1 });
  return ps;
}
async function outForDelivery(n = 1) {
  const ps = await toHub(n);
  await scanAt(net.hub.id, 'hub_bag', 'S1');
  for (const p of ps) await scanAt(net.hub.id, 'hub_receive', p.tracking, { bagSeal: 'S1' });
  const run = (await post('/parcels/runs', { hubId: net.hub.id, courierId: omarId })).body;
  for (const p of ps) await scanAt(net.hub.id, 'dispatch', p.tracking, { runId: run.id });
  await post(`/parcels/runs/${run.id}/out`, {});
  return { ps, run };
}
const courierPost = (url: string, body: object) => post(url, { deviceScanId: crypto.randomUUID(), ...body }, omar);

describe('receive at the hub', () => {
  it('makes a missing gap for a parcel in the bag that was not scanned', async () => {
    const [a, b] = await toHub(2);
    expect((await scanAt(net.hub.id, 'hub_bag', 'S1')).body).toMatchObject({ ok: true, big: '2' });
    expect((await scanAt(net.hub.id, 'hub_receive', a.tracking, { bagSeal: 'S1' })).body).toMatchObject({ ok: true, big: '1/2' });
    expect(await statusOf(a.id)).toBe('at_hub');
    expect((await post('/parcels/hub/bags/S1/done', {})).body).toMatchObject({ missing: 1, extra: 0 });
    expect(await db.gap.findMany({ where: { kind: 'missing' } })).toEqual([expect.objectContaining({ parcelId: b.id, siteId: net.hub.id })]);
    expect((await scanAt(net.hub.id, 'hub_sort', a.tracking)).body).toMatchObject({ ok: true, big: 'MAA-A' });
  });
});

describe('dispatch', () => {
  it('suggests the courier who covers the zone, and refuses another hub parcel', async () => {
    expect((await http().put(`/parcels/couriers/${omarId}/zones`).set('Cookie', owner).send({ zoneIds: [net.zone.id] })).status).toBe(200);
    const suggest = (await http().get(`/parcels/hub/${net.hub.id}/suggest?zone=${net.zone.id}`).set('Cookie', owner)).body;
    expect(suggest.map((s: { courierId: string }) => s.courierId)).toEqual([omarId]);
    const [a] = await toHub(1);
    await scanAt(net.hub.id, 'hub_bag', 'S1');
    await scanAt(net.hub.id, 'hub_receive', a!.tracking, { bagSeal: 'S1' });
    const hub2 = (await post('/location/sites', { kind: 'last_mile_hub', code: 'DEG', nameEn: 'Degla hub', nameAr: 'مركز دجلة', sortingFacilityId: net.facility.id })).body;
    const run2 = (await post('/parcels/runs', { hubId: hub2.id, courierId: aliId })).body;
    expect((await scanAt(hub2.id, 'dispatch', a!.tracking, { runId: run2.id })).body).toMatchObject({ ok: false, colour: 'red', reason: 'other_hub' });
    expect(await statusOf(a!.id)).toBe('at_hub');
  });
});

describe('delivery', () => {
  it('books the COD and fees once even when the courier taps Deliver twice', async () => {
    const { ps } = await outForDelivery();
    const p = ps[0]!;
    const run = (await http().get('/parcels/me/run').set('Cookie', omar)).body;
    expect(run.stops.map((s: { tracking: string }) => s.tracking)).toEqual([p.tracking]);
    expect((await courierPost(`/parcels/me/parcels/${p.id}/deliver`, { cash: '99', proof: 'none' })).body).toMatchObject({ ok: false, reason: 'wrong_cash' });
    const first = await courierPost(`/parcels/me/parcels/${p.id}/deliver`, { cash: '100', proof: 'otp' });
    expect(first.body).toMatchObject({ ok: true });
    expect((await courierPost(`/parcels/me/parcels/${p.id}/deliver`, { cash: '100', proof: 'otp' })).body).toMatchObject({ ok: false, reason: 'wrong_status' });
    await processDue(db);
    expect(await statusOf(p.id)).toBe('delivered');
    // 100 COD − 45 delivery − 1 COD fee (1%) − 14% VAT on 46
    expect(await app.get(WalletsService).available(net.merchant.id)).toBe(10000 - 4500 - 100 - 644);
    expect((await http().get('/parcels/me/cash').set('Cookie', omar)).body).toEqual({ held: 10000 });
    const holder = await db.cashHolder.findFirstOrThrow({ where: { kind: 'courier', refId: omarId } });
    expect(holder.companyKey).toBe('shiply');
  });

  it('puts a parcel on hold for return after the last allowed attempt, and returns it to the merchant', async () => {
    const { ps, run } = await outForDelivery();
    const p = ps[0]!;
    for (let i = 1; i <= 3; i++) {
      expect((await courierPost(`/parcels/me/parcels/${p.id}/fail`, { reason: 'no_answer' })).body).toMatchObject({ ok: true });
      if (i < 3) await scanAt(net.hub.id, 'dispatch', p.tracking, { runId: run.id });
    }
    expect(await db.parcel.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: 'on_hold', direction: 'return', attempts: 3 });
    expect((await post(`/parcels/runs/${run.id}/close`, {})).body.error).toBe('parcels_not_back');
    await scanAt(net.hub.id, 'hub_return', p.tracking);
    expect((await post(`/parcels/runs/${run.id}/close`, {})).status).toBe(200);
    // back to the merchant's facility in a return bag
    await scanAt(net.hub.id, 'outbound', p.tracking, { bagSeal: 'R1' });
    await post('/parcels/bags/R1/close', {});
    const car = (await post('/parcels/cars', { fromSiteId: net.hub.id, toSiteId: net.facility.id, driverName: 'Hassan' })).body;
    await scanAt(net.hub.id, 'car_load', 'R1', { carId: car.id });
    await post(`/parcels/cars/${car.id}/depart`, { driverCount: 1 });
    await scanAt(net.facility.id, 'hub_bag', 'R1');
    await scanAt(net.facility.id, 'hub_receive', p.tracking, { bagSeal: 'R1' });
    expect(await statusOf(p.id)).toBe('at_inbound');
    await db.pickup.create({ data: { merchantId: net.merchant.id, date: new Date(new Date().toISOString().slice(0, 10)), courierId: omarId, status: 'assigned', createdById: omarId } });
    expect((await post('/parcels/scan', scanBody('return_handover', p.tracking), omar)).body).toMatchObject({ ok: true });
    await processDue(db);
    expect(await statusOf(p.id)).toBe('returned');
    // a return fee of 50% of 45 EGP, plus VAT
    expect(await app.get(WalletsService).available(net.merchant.id)).toBe(-(2250 + 315));
  });
});

describe('office reads', () => {
  it('gives the Shiply screens their lookups, overview and failed attempts', async () => {
    const { ps } = await outForDelivery();
    await courierPost(`/parcels/me/parcels/${ps[0]!.id}/fail`, { reason: 'refused' });
    const viewer = await signIn(app, '01012345678', 'viewer-pass-1');
    const look = (await http().get('/parcels/lookups').set('Cookie', viewer)).body;
    expect(look.sites.map((s: { code: string }) => s.code)).toEqual(['MAA', 'OBR']);
    expect(look.zones.map((z: { code: string }) => z.code)).toEqual(['MAA-A']);
    expect(look.merchants).toEqual([expect.objectContaining({ id: net.merchant.id, code: 'EVE', name: 'Eve' })]);
    expect(look.couriers.map((c: { id: string }) => c.id).sort()).toEqual([omarId, aliId].sort());
    expect((await http().get('/parcels/me/sites').set('Cookie', owner)).body.map((x: { code: string }) => x.code)).toEqual(['MAA', 'OBR']);
    expect((await http().get('/parcels/me/sites').set('Cookie', viewer)).body).toEqual([]);
    const ov = (await http().get('/parcels/overview').set('Cookie', viewer)).body;
    expect(ov.byStatus.attempt_failed).toBe(1);
    expect(ov.failureByHub).toEqual([expect.objectContaining({ hubId: net.hub.id, attempts: 1, failed: 1 })]);
    const failed = (await http().get('/parcels/attempts?result=failed').set('Cookie', viewer)).body;
    expect(failed).toEqual([expect.objectContaining({ tracking: ps[0]!.tracking, reason: 'refused', number: 1 })]);
  });
});
