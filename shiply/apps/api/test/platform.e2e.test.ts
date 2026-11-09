import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { db, resetDb, signIn, startApp } from './helpers';

let app: INestApplication;

beforeEach(async () => {
  await resetDb();
  app ??= await startApp();
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});

const http = () => request(app.getHttpServer());

describe('login', () => {
  it('accepts a mobile typed with Arabic digits', async () => {
    const res = await http().post('/auth/login').send({ login: '٠١٠١٢٣٤٥٦٧٨', password: 'viewer-pass-1' });
    expect(res.status).toBe(200);
    expect(String(res.headers['set-cookie'])).toContain('sid=');
  });

  it('accepts an email in any letter case', async () => {
    const res = await http().post('/auth/login').send({ login: 'Owner@Test.Local', password: 'owner-pass-1' });
    expect(res.status).toBe(200);
  });

  it('locks the account after 5 wrong passwords', async () => {
    for (let i = 0; i < 5; i++) {
      const bad = await http().post('/auth/login').send({ login: '01012345678', password: 'wrong' });
      expect(bad.status).toBe(401);
    }
    const locked = await http().post('/auth/login').send({ login: '01012345678', password: 'viewer-pass-1' });
    expect(locked.status).toBe(429);
    expect(locked.body.error).toBe('locked');
  });

  it('answers 401 signed_out without a session', async () => {
    const res = await http().get('/me');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'signed_out' });
  });
});

describe('access', () => {
  it('refuses a viewer creating a user', async () => {
    const cookies = await signIn(app, '01012345678', 'viewer-pass-1');
    const res = await http()
      .post('/users')
      .set('Cookie', cookies)
      .send({ name: 'X', nameAr: 'س', mobile: '01112345678', password: 'pass-12345', roleKey: 'viewer' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'no_access', app: 'settings', need: 'manage' });
  });

  it('gives the viewer 12 tiles with no counts on Home', async () => {
    const cookies = await signIn(app, '01012345678', 'viewer-pass-1');
    const res = await http().get('/me/home').set('Cookie', cookies);
    expect(res.status).toBe(200);
    expect(res.body.tiles).toHaveLength(12);
    expect(res.body.tiles.every((t: { count: number }) => t.count === 0)).toBe(true);
    expect(res.body.attention).toEqual([]);
  });
});

describe('writes', () => {
  it('does the same request once when sent twice with one Idempotency-Key', async () => {
    const cookies = await signIn(app, 'owner@test.local', 'owner-pass-1');
    const body = { name: 'Sara', nameAr: 'سارة', mobile: '01112345678', password: 'pass-12345', roleKey: 'viewer' };
    const a = await http().post('/users').set('Cookie', cookies).set('Idempotency-Key', 'k1').send(body);
    const b = await http().post('/users').set('Cookie', cookies).set('Idempotency-Key', 'k1').send(body);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body).toEqual(a.body);
    expect(await db.user.count({ where: { mobile: '+201112345678' } })).toBe(1);
  });

  it('audits a new user without the password hash', async () => {
    const cookies = await signIn(app, 'owner@test.local', 'owner-pass-1');
    const res = await http()
      .post('/users')
      .set('Cookie', cookies)
      .send({ name: 'Omar', nameAr: 'عمر', email: 'omar@test.local', password: 'pass-12345', roleKey: 'viewer' });
    expect(res.status).toBe(201);
    expect(res.body.passwordHash).toBeUndefined();
    const log = await db.auditLog.findFirstOrThrow({ where: { entity: 'user', entityId: res.body.id } });
    expect(log.action).toBe('user.created');
    expect(JSON.stringify(log.after)).not.toContain('password');
  });

  it('stores settings and reads them back', async () => {
    const cookies = await signIn(app, 'owner@test.local', 'owner-pass-1');
    const put = await http().put('/settings/auth.lockout_minutes').set('Cookie', cookies).send({ value: 30 });
    expect(put.status).toBe(200);
    const get = await http().get('/settings/auth.lockout_minutes').set('Cookie', cookies);
    expect(get.body).toEqual({ key: 'auth.lockout_minutes', value: 30 });
  });
});
