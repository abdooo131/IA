import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { hash } from 'argon2';
import type { INestApplication } from '@nestjs/common';
import { db, resetDb, signIn, startApp } from './helpers';
import { network } from './parcel-fixtures';

let app: INestApplication;
let owner: string[];
let second: string[];
let net: Awaited<ReturnType<typeof network>>;
beforeEach(async () => {
  await resetDb();
  app ??= await startApp();
  const role = await db.jobRole.findUniqueOrThrow({ where: { key: 'owner' } });
  await db.user.create({ data: { name: 'Second', nameAr: 'ثاني', email: 'second@test.local', passwordHash: await hash('second-pass-1'), roleId: role.id } });
  owner = await signIn(app, 'owner@test.local', 'owner-pass-1');
  second = await signIn(app, 'second@test.local', 'second-pass-1');
  net = await network(app, owner);
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});
const http = () => request(app.getHttpServer());
const post = (url: string, body: object, cookies = owner) => http().post(url).set('Cookie', cookies).send(body);
const newAgent = async (code = 'FAST') => (await post('/agents', { code, name: 'Fast Couriers', nameAr: 'فاست', contactName: 'Adel', phone: '01000000001', services: ['shiply'], perDelivery: '20', perPickup: '15', perTrip: '300' })).body;
const newPerson = async (agentId: string, mobile = '01234567890') =>
  (await post('/agents/people', { agentId, role: 'delivery', name: 'Tamer', nameAr: 'تامر', mobile, password: 'tamer-pass-1' })).body;

describe('agents and people', () => {
  it('stores rates as piastres', async () => {
    const a = await newAgent();
    expect(a).toMatchObject({ code: 'FAST', perDelivery: 2000, perPickup: 1500, perTrip: 30000 });
  });

  it('needs a second person to approve a new courier', async () => {
    const a = await newAgent();
    const p = await newPerson(a.id);
    expect(p.status).toBe('pending');
    const own = await post(`/agents/people/${p.id}/approve`, {});
    expect([own.status, own.body.error]).toEqual([403, 'own_person']);
    expect((await post(`/agents/people/${p.id}/approve`, {}, second)).body.status).toBe('approved');
  });

  it('refuses a taken mobile', async () => {
    const a = await newAgent();
    await newPerson(a.id);
    const again = await post('/agents/people', { agentId: a.id, role: 'delivery', name: 'X', nameAr: 'X', mobile: '01234567890', password: 'x-pass-12345' });
    expect([again.status, again.body.error]).toEqual([409, 'login_taken']);
  });
});

describe('the work gate', () => {
  it('lets only approved people of an active agent take a run', async () => {
    const a = await newAgent();
    const p = await newPerson(a.id);
    const run = () => post('/parcels/runs', { hubId: net.hub.id, courierId: p.userId });
    const pending = await run();
    expect([pending.status, pending.body.error]).toEqual([400, 'person_cannot_work']);
    await post(`/agents/people/${p.id}/approve`, {}, second);
    await http().patch(`/agents/${a.id}`).set('Cookie', owner).send({ active: false });
    expect((await run()).body.error).toBe('person_cannot_work');
    await http().patch(`/agents/${a.id}`).set('Cookie', owner).send({ active: true });
    expect((await run()).status).toBe(201);
  });

  it('refuses assigning a pickup to someone who cannot work', async () => {
    const a = await newAgent();
    const p = await newPerson(a.id);
    const pk = (await post('/parcels/pickups', { merchantId: net.merchant.id, date: '2026-11-10' })).body;
    expect((await post(`/parcels/pickups/${pk.id}/assign`, { courierId: p.userId })).body.error).toBe('person_cannot_work');
  });
});
