import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { LocationService } from '../src/location';
import { processDue } from '../src/platform/events';
import { db, resetDb, signIn, startApp } from './helpers';
import { courier, network, scanBody, walk } from './parcel-fixtures';

let app: INestApplication;
let owner: string[];
let omar: string[];
let ali: string[];
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
  ali = await signIn(app, '01222222222', 'ali-pass-1');
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});
const http = () => request(app.getHttpServer());
const post = async (url: string, body: object, cookies = owner) => http().post(url).set('Cookie', cookies).send(body);
const parcel = async (address = 'شارع 9 المعادي الجديدة', size = 'small') =>
  (await post('/parcels', { merchantId: net.merchant.id, customerName: 'Sara', phone: '01001234567', address, size, cod: '100' })).body as { id: string; tracking: string };
const go = (tracking: string[], upTo: 'picked_up' | 'at_inbound' | 'sorted') => walk(post as never, { courier: omar, staff: owner }, { merchantId: net.merchant.id, facilityId: net.facility.id, courierId: omarId }, tracking, upTo);
const scanAt = (siteId: string, step: string, code: string, extra: object = {}) => post('/parcels/scan', scanBody(step, code, { siteId, ...extra }));
const statusOf = async (id: string) => (await db.parcel.findUniqueOrThrow({ where: { id } })).status;
const today = () => new Date(new Date().toISOString().slice(0, 10));

describe('parcels review fixes', () => {
  it('answers two Deliver taps at the same moment without a server error', async () => {
    const p = await parcel();
    await go([p.tracking], 'sorted');
    await db.parcel.update({ where: { id: p.id }, data: { status: 'at_hub' } });
    const run = (await post('/parcels/runs', { hubId: net.hub.id, courierId: omarId })).body;
    await scanAt(net.hub.id, 'dispatch', p.tracking, { runId: run.id });
    const tap = () => post(`/parcels/me/parcels/${p.id}/deliver`, { deviceScanId: crypto.randomUUID(), cash: '100', proof: 'none' }, omar);
    const [a, b] = await Promise.all([tap(), tap()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.body.ok, b.body.ok].sort()).toEqual([false, true]);
  });

  it('receives the parcels of a bag that was never loaded on a car', async () => {
    const p = await parcel();
    await go([p.tracking], 'sorted');
    await scanAt(net.facility.id, 'outbound', p.tracking, { bagSeal: 'NL1' });
    await post('/parcels/bags/NL1/close', {});
    expect((await scanAt(net.hub.id, 'hub_bag', 'NL1')).body).toMatchObject({ ok: true, colour: 'amber' });
    expect((await scanAt(net.hub.id, 'hub_receive', p.tracking, { bagSeal: 'NL1' })).body).toMatchObject({ ok: true });
    expect(await statusOf(p.id)).toBe('at_hub');
    expect((await scanAt(net.hub.id, 'hub_bag', 'NL1')).body).toMatchObject({ ok: false, reason: 'already_received' });
    expect(await db.gap.count({ where: { kind: 'extra' } })).toBe(1);
  });

  it('flags a parcel with no price at sorting', async () => {
    const p = await parcel('شارع 9 المعادي الجديدة', 'large');
    await go([p.tracking], 'at_inbound');
    expect((await scanAt(net.facility.id, 'sorting', p.tracking)).body).toMatchObject({ ok: true, colour: 'amber', reason: 'no_price' });
    expect(await statusOf(p.id)).toBe('sorted');
  });

  it('does not re route a parcel already on its way when its address is picked late', async () => {
    const p = (await post('/parcels', { merchantId: net.merchant.id, customerName: 'S', phone: '01001234567', address: 'الحي السابع', size: 'small', cod: '0' })).body;
    await db.parcel.update({ where: { id: p.id }, data: { status: 'in_transit' } });
    const ownerId = (await db.user.findFirstOrThrow({ where: { email: 'owner@test.local' } })).id;
    await app.get(LocationService).pick(p.decisionId, 'degla', ownerId);
    await processDue(db);
    expect(await db.parcel.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ placeId: null, hubId: null });
  });

  it('lets only a courier picking up from that merchant today hand a return back', async () => {
    const p = await parcel();
    await db.parcel.update({ where: { id: p.id }, data: { status: 'at_inbound', direction: 'return', originFacilityId: net.facility.id } });
    expect((await post('/parcels/scan', scanBody('return_handover', p.tracking), ali)).body).toMatchObject({ ok: false, reason: 'not_your_merchant' });
    await db.pickup.create({ data: { merchantId: net.merchant.id, date: today(), courierId: omarId, status: 'assigned', createdById: omarId } });
    expect((await post('/parcels/scan', scanBody('return_handover', p.tracking), omar)).body).toMatchObject({ ok: true });
  });
});
