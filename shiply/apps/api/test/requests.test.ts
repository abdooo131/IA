import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { ParcelsService } from '../src/parcels';
import { publish } from '../src/platform';
import { processDue } from '../src/platform/events';
import { db, resetDb, signIn, startApp } from './helpers';
import { courier, network } from './parcel-fixtures';

let app: INestApplication;
let owner: string[];
let net: Awaited<ReturnType<typeof network>>;
let fast: { id: string };
let slow: { id: string };
let fastBoss: string[];
let slowBoss: string[];
beforeEach(async () => {
  await resetDb();
  app ??= await startApp();
  owner = await signIn(app, 'owner@test.local', 'owner-pass-1');
  net = await network(app, owner);
  fast = (await post('/agents', { code: 'FAST', name: 'Fast', nameAr: 'فاست', contactName: 'Adel', phone: '01000000001', services: ['shiply'], perTrip: '300' })).body;
  slow = (await post('/agents', { code: 'SLOW', name: 'Slow', nameAr: 'سلو', contactName: 'Badr', phone: '01000000002', services: ['shiply'] })).body;
  await post('/agents/managers', { agentId: fast.id, name: 'Adel', nameAr: 'عادل', email: 'adel@fast.local', password: 'adel-pass-12' });
  await post('/agents/managers', { agentId: slow.id, name: 'Badr', nameAr: 'بدر', email: 'badr@slow.local', password: 'badr-pass-12' });
  fastBoss = await signIn(app, 'adel@fast.local', 'adel-pass-12');
  slowBoss = await signIn(app, 'badr@slow.local', 'badr-pass-12');
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});
const http = () => request(app.getHttpServer());
const post = (url: string, body: object, cookies = owner) => http().post(url).set('Cookie', cookies).send(body);

describe('requests', () => {
  it('is confirmed once by the agent it went to, and hidden from other agents', async () => {
    const r = (await post('/agents/requests', { siteId: net.hub.id, date: '2026-11-12', role: 'delivery', count: 3, agentId: fast.id })).body;
    expect((await http().get('/agents/me/requests').set('Cookie', slowBoss)).body).toEqual([]);
    expect((await post(`/agents/me/requests/${r.id}/confirm`, {}, slowBoss)).status).toBe(404);
    expect((await post(`/agents/me/requests/${r.id}/confirm`, {}, fastBoss)).body.status).toBe('confirmed');
    expect((await post(`/agents/me/requests/${r.id}/confirm`, {}, fastBoss)).status).toBe(409);
  });

  it('keeps office routes away from agent managers', async () => {
    expect((await http().get('/agents/requests').set('Cookie', fastBoss)).status).toBe(403);
  });
});

describe('work log', () => {
  it('counts a delivery once even when its event comes twice, and names the courier', async () => {
    const omar = await courier('omar', '01111111111');
    const p = await db.parcel.create({ data: { tracking: 'SP0000000001', merchantId: net.merchant.id, customerName: 'x', phone: '+201001234567', addressText: 'x', size: 'small', status: 'out_for_delivery', courierId: omar.id, createdById: omar.id } });
    await db.$transaction((tx) => app.get(ParcelsService).move(tx, p.id, 'delivered', { userId: omar.id }));
    const ev = await db.outboxEvent.findFirstOrThrow({ where: { type: 'parcel.status_changed' } });
    expect(ev.payload).toMatchObject({ to: 'delivered', courierId: omar.id });
    await db.$transaction((tx) => publish(tx, 'parcel.status_changed', ev.payload as object, 'again'));
    await processDue(db);
    expect(await db.workLog.findMany()).toEqual([expect.objectContaining({ kind: 'delivery', personUserId: omar.id, companyKey: 'shiply' })]);
  });

  it('writes one trip for the route agent when a car made from the route departs', async () => {
    const route = (await post('/agents/routes', { code: 'OBR-MAA', fromSiteId: net.facility.id, toSiteId: net.hub.id, departAt: '22:30', agentId: fast.id })).body;
    const car = (await post('/parcels/cars', { routeId: route.id })).body;
    expect(car).toMatchObject({ fromSiteId: net.facility.id, toSiteId: net.hub.id, routeId: route.id });
    expect((await post(`/parcels/cars/${car.id}/depart`, { driverCount: 0 })).status).toBe(200);
    await processDue(db);
    await processDue(db);
    expect(await db.workLog.findMany()).toEqual([expect.objectContaining({ kind: 'trip', agentId: fast.id })]);
  });
});
