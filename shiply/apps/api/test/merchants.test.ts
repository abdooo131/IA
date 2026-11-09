import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { processDue } from '../src/platform/events';
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
const base = { contactName: 'Mona', contactPhone: '01012345678', services: ['shiply'] };

describe('merchants', () => {
  it('makes a short unique code from the name', async () => {
    const a = await post('/merchants', { ...base, name: 'Eve Chantelle' });
    const b = await post('/merchants', { ...base, name: 'eve chantelle' });
    expect(a.status).toBe(201);
    expect([a.body.code, b.body.code]).toEqual(['EVE', 'EVE2']);
    expect(a.body.contactPhone).toBe('+201012345678');
  });

  it('places the pickup address, and fills an unclear one once CS picks its area', async () => {
    const clear = await post('/merchants', { ...base, name: 'Nile Pantry', pickupAddress: 'شارع 9 المعادي الجديدة' });
    expect(clear.body.pickupPlaceId).toBe('new-maadi');
    const unclear = await post('/merchants', { ...base, name: 'Bayt', pickupAddress: 'الحي السابع' });
    expect(unclear.body.pickupPlaceId).toBeNull();
    await post(`/location/queue/${unclear.body.pickupDecisionId}/pick`, { placeId: 'nasr-city-hay-7' });
    await processDue(db);
    expect((await http().get(`/merchants/${unclear.body.id}`).set('Cookie', owner)).body.pickupPlaceId).toBe('nasr-city-hay-7');
  });

  it('approves a waiting sign up once', async () => {
    const m = await db.merchant.create({ data: { code: 'NEW', name: 'New Shop', contactName: 'Ali', contactPhone: '+201112345678', services: ['shiply'], status: 'pending' } });
    expect((await http().get('/merchants/signups').set('Cookie', owner)).body.rows).toHaveLength(1);
    expect((await post(`/merchants/${m.id}/approve`, {})).status).toBe(200);
    expect((await post(`/merchants/${m.id}/approve`, {})).status).toBe(409);
  });

  it('gives a merchant login no office apps, and deactivating the merchant stops it', async () => {
    const m = (await post('/merchants', { ...base, name: 'Eve Chantelle' })).body;
    const u = await post(`/merchants/${m.id}/users`, { name: 'Eve Owner', nameAr: 'إيف', email: 'eve@shop.test', password: 'eve-pass-123', role: 'owner' });
    expect(u.status).toBe(201);
    const cookies = await signIn(app, 'eve@shop.test', 'eve-pass-123');
    const me = (await http().get('/me').set('Cookie', cookies)).body;
    expect(me.kind).toBe('merchant_user');
    expect(Object.values(me.access).every((l) => l === 'none')).toBe(true);
    expect((await post(`/merchants/${m.id}/deactivate`, {})).status).toBe(200);
    expect((await http().post('/auth/login').send({ login: 'eve@shop.test', password: 'eve-pass-123' })).status).toBe(401);
  });

  it('refuses a viewer creating a merchant', async () => {
    const viewer = await signIn(app, '01012345678', 'viewer-pass-1');
    expect((await post('/merchants', { ...base, name: 'X' }, viewer)).status).toBe(403);
  });
});

describe('merchants review fixes', () => {
  it('keeps merchant logins out of Settings, so they cannot be switched back on or made office users', async () => {
    const m = (await post('/merchants', { ...base, name: 'Eve Chantelle' })).body;
    await post(`/merchants/${m.id}/users`, { name: 'Eve Owner', nameAr: 'إيف', email: 'eve@shop.test', password: 'eve-pass-123', role: 'owner' });
    await post(`/merchants/${m.id}/deactivate`, {});
    const users = (await http().get('/users').set('Cookie', owner)).body.rows;
    expect(users.some((u: { email: string }) => u.email === 'eve@shop.test')).toBe(false);
    const login = await db.user.findUniqueOrThrow({ where: { email: 'eve@shop.test' } });
    const res = await http().patch(`/users/${login.id}`).set('Cookie', owner).send({ active: true, roleKey: 'owner' });
    expect(res.status).toBe(403);
    expect((await http().post('/auth/login').send({ login: 'eve@shop.test', password: 'eve-pass-123' })).status).toBe(401);
  });

  it('refuses a new login for an inactive merchant', async () => {
    const m = (await post('/merchants', { ...base, name: 'Eve Chantelle' })).body;
    await post(`/merchants/${m.id}/deactivate`, {});
    const res = await post(`/merchants/${m.id}/users`, { name: 'Late', nameAr: 'متأخر', email: 'late@shop.test', password: 'late-pass-123' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('merchant_inactive');
  });
});
