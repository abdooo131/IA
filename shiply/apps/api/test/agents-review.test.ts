import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { hash } from 'argon2';
import type { INestApplication } from '@nestjs/common';
import { db, resetDb, signIn, startApp } from './helpers';
import { courier, network, scanBody } from './parcel-fixtures';

let app: INestApplication;
let owner: string[];
let second: string[];
let net: Awaited<ReturnType<typeof network>>;
let agentId: string;
beforeEach(async () => {
  await resetDb();
  app ??= await startApp();
  const role = await db.jobRole.findUniqueOrThrow({ where: { key: 'owner' } });
  await db.user.create({ data: { name: 'Second', nameAr: 'ثاني', email: 'second@test.local', passwordHash: await hash('second-pass-1'), roleId: role.id } });
  owner = await signIn(app, 'owner@test.local', 'owner-pass-1');
  second = await signIn(app, 'second@test.local', 'second-pass-1');
  net = await network(app, owner);
  agentId = (await post('/agents', { code: 'FAST', name: 'Fast', nameAr: 'فاست', contactName: 'Adel', phone: '01000000001', services: ['shiply'] })).body.id;
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});
const http = () => request(app.getHttpServer());
const post = (url: string, body: object, cookies = owner) => http().post(url).set('Cookie', cookies).send(body);
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe('agents review fixes', () => {
  it('checks documents the moment a person is approved', async () => {
    const p = (await post('/agents/people', { agentId, role: 'delivery', name: 'Tamer', nameAr: 'تامر', mobile: '01234567890', password: 'tamer-pass-1' })).body;
    await post(`/agents/people/${p.id}/approve`, {}, second);
    expect(await db.person.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: 'approved', blocked: true });
    expect((await post('/parcels/runs', { hubId: net.hub.id, courierId: p.userId })).body.error).toBe('person_cannot_work');
  });

  it('stops a blocked courier picking up and having parcels loaded on his run', async () => {
    const omar = await courier('omar', '01111111111');
    const omarCookies = await signIn(app, '01111111111', 'omar-pass-1');
    const pk = (await post('/parcels/pickups', { merchantId: net.merchant.id, date: '2026-11-10' })).body;
    await post(`/parcels/pickups/${pk.id}/assign`, { courierId: omar.id });
    const run = (await post('/parcels/runs', { hubId: net.hub.id, courierId: omar.id })).body;
    const parcel = (await post('/parcels', { merchantId: net.merchant.id, customerName: 'S', phone: '01001234567', address: 'شارع 9 المعادي الجديدة', size: 'small', cod: '0' })).body;
    await db.person.update({ where: { userId: omar.id }, data: { blocked: true, blockedReason: 'driving_licence' } });
    expect((await post('/parcels/scan', scanBody('pickup', parcel.tracking, { pickupId: pk.id }), omarCookies)).body).toMatchObject({ ok: false, reason: 'person_cannot_work' });
    await db.parcel.update({ where: { id: parcel.id }, data: { status: 'at_hub' } });
    expect((await post('/parcels/scan', scanBody('dispatch', parcel.tracking, { siteId: net.hub.id, runId: run.id }))).body).toMatchObject({ ok: false, reason: 'person_cannot_work' });
  });

  it('refuses a settlement period that is not over yet', async () => {
    const res = await post('/agents/settlements', { agentId, from: day(-3), to: day(0) });
    expect([res.status, res.body.error]).toEqual([400, 'period_not_over']);
  });

  it('keeps a request to any agent open for the others when one declines', async () => {
    const slow = (await post('/agents', { code: 'SLOW', name: 'Slow', nameAr: 'سلو', contactName: 'B', phone: '01000000002', services: ['shiply'] })).body;
    await post('/agents/managers', { agentId, name: 'A', nameAr: 'A', email: 'a@fast.local', password: 'a-pass-123456' });
    await post('/agents/managers', { agentId: slow.id, name: 'B', nameAr: 'B', email: 'b@slow.local', password: 'b-pass-123456' });
    const a = await signIn(app, 'a@fast.local', 'a-pass-123456');
    const b = await signIn(app, 'b@slow.local', 'b-pass-123456');
    const r = (await post('/agents/requests', { siteId: net.hub.id, date: day(2), role: 'delivery', count: 2 })).body;
    expect((await post(`/agents/me/requests/${r.id}/decline`, {}, a)).status).toBe(200);
    expect((await http().get('/agents/me/requests').set('Cookie', a)).body).toEqual([]);
    expect((await post(`/agents/me/requests/${r.id}/confirm`, {}, b)).body.status).toBe('confirmed');
  });

  it('lists only the newest document of each kind on Compliance', async () => {
    const p = (await post('/agents/people', { agentId, role: 'delivery', name: 'Tamer', nameAr: 'تامر', mobile: '01234567890', password: 'tamer-pass-1' })).body;
    await post(`/agents/people/${p.id}/approve`, {}, second);
    await post('/agents/documents', { personId: p.id, kind: 'driving_licence', number: 'OLD', expiresAt: '2026-01-01' });
    await post('/agents/documents', { personId: p.id, kind: 'driving_licence', number: 'NEW', expiresAt: '2028-01-01' });
    const r = (await http().get('/agents/compliance').set('Cookie', owner)).body;
    expect(r.expired.map((d: { number: string }) => d.number)).toEqual([]);
  });

  it('makes no car from the route of an inactive agent', async () => {
    const route = (await post('/agents/routes', { code: 'OBR-MAA', fromSiteId: net.facility.id, toSiteId: net.hub.id, departAt: '22:30', agentId })).body;
    await http().patch(`/agents/${agentId}`).set('Cookie', owner).send({ active: false });
    expect((await post('/parcels/cars', { routeId: route.id })).status).toBe(404);
  });
});
