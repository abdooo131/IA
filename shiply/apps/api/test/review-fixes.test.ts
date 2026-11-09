import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { clearHandlers, onEvent, publish } from '../src/platform/events';
import { recordFailure } from '../src/platform/events/worker';
import { db, resetDb, signIn, startApp } from './helpers';

let app: INestApplication;
beforeEach(async () => {
  await resetDb();
  clearHandlers();
  app ??= await startApp();
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});
const http = () => request(app.getHttpServer());
const body = { name: 'Sara', nameAr: 'سارة', mobile: '01112345678', password: 'pass-12345', roleKey: 'viewer' };

describe('review fixes', () => {
  it('does a write once when two copies arrive at the same moment', async () => {
    const cookies = await signIn(app, 'owner@test.local', 'owner-pass-1');
    const send = () => http().put('/settings/auth.lockout_minutes').set('Cookie', cookies).set('Idempotency-Key', 'same-time').send({ value: 20 });
    await Promise.all([send(), send(), send()]);
    expect(await db.auditLog.count({ where: { action: 'setting.changed' } })).toBe(1);
  });

  it('refuses one Idempotency-Key reused on another route', async () => {
    const cookies = await signIn(app, 'owner@test.local', 'owner-pass-1');
    await http().post('/users').set('Cookie', cookies).set('Idempotency-Key', 'k').send(body);
    const res = await http().put('/settings/auth.lockout_minutes').set('Cookie', cookies).set('Idempotency-Key', 'k').send({ value: 20 });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('idempotency_key_reused');
  });

  it('ends the session for good on logout', async () => {
    const cookies = await signIn(app, 'owner@test.local', 'owner-pass-1');
    await http().post('/auth/logout').set('Cookie', cookies);
    expect((await http().get('/me').set('Cookie', cookies)).status).toBe(401);
    expect((await http().post('/auth/refresh').set('Cookie', cookies)).status).toBe(401);
  });

  it('keeps the lockout when wrong passwords arrive in parallel', async () => {
    await Promise.all(Array.from({ length: 10 }, () => http().post('/auth/login').send({ login: '01012345678', password: 'wrong' })));
    const res = await http().post('/auth/login').send({ login: '01012345678', password: 'viewer-pass-1' });
    expect(res.status).toBe(429);
  });

  it('refuses a setting value that would break the system', async () => {
    const cookies = await signIn(app, 'owner@test.local', 'owner-pass-1');
    for (const [key, value] of [
      ['auth.session_minutes', 'x'],
      ['auth.max_failed_logins', 0],
      ['events.retry_minutes', 5],
    ] as const) {
      const res = await http().put(`/settings/${key}`).set('Cookie', cookies).send({ value });
      expect(res.status, key).toBe(400);
    }
  });

  it('counts a failed delivery once even if two workers record it', async () => {
    onEvent('t.x', 'h', async () => undefined);
    await db.$transaction((tx) => publish(tx, 't.x', {}, 'k-fail'));
    const d = await db.eventDelivery.findFirstOrThrow();
    const now = new Date();
    await Promise.all([recordFailure(db, d.eventId, 'h', 0, new Error('a'), now), recordFailure(db, d.eventId, 'h', 0, new Error('b'), now)]);
    expect((await db.eventDelivery.findFirstOrThrow()).attempts).toBe(1);
  });
});
