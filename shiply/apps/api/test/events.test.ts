import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { clearHandlers, onEvent, processDue, publish } from '../src/platform/events';
import { db, resetDb, signIn, startApp } from './helpers';

let app: INestApplication;
const runs: string[] = [];
const MIN = 60_000;

beforeEach(async () => {
  await resetDb();
  runs.length = 0;
  clearHandlers();
  app ??= await startApp();
});
afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});

describe('events', () => {
  it('never delivers an event whose transaction rolled back', async () => {
    onEvent('test.happened', 'recorder', async (p) => {
      runs.push(String((p as { n: number }).n));
    });
    await db
      .$transaction(async (tx) => {
        await publish(tx, 'test.happened', { n: 1 }, 'k-rolled-back');
        throw new Error('stop');
      })
      .catch(() => undefined);
    await processDue(db);
    expect(runs).toEqual([]);
    expect(await db.outboxEvent.count()).toBe(0);
  });

  it('publishes the same key once', async () => {
    onEvent('test.happened', 'recorder', async () => {
      runs.push('x');
    });
    await db.$transaction((tx) => publish(tx, 'test.happened', { n: 1 }, 'same'));
    await db.$transaction((tx) => publish(tx, 'test.happened', { n: 1 }, 'same'));
    await processDue(db);
    expect(runs).toEqual(['x']);
  });

  it('retries a failing handler with backoff, then marks it dead with the error', async () => {
    onEvent('test.happened', 'breaks', async () => {
      throw new Error('handler is broken');
    });
    await db.$transaction((tx) => publish(tx, 'test.happened', {}, 'k-dead'));
    let now = Date.now();
    for (const wait of [0, 1, 5, 30, 120]) {
      now += wait * MIN + 1000;
      await processDue(db, new Date(now));
    }
    const d = await db.eventDelivery.findFirstOrThrow();
    expect(d.status).toBe('dead');
    expect(d.attempts).toBe(5);
    expect(d.lastError).toContain('handler is broken');
  });

  it('runs a handler once even when two workers run at the same time', async () => {
    onEvent('test.happened', 'slow', async () => {
      await new Promise((r) => setTimeout(r, 200));
      runs.push('ran');
    });
    await db.$transaction((tx) => publish(tx, 'test.happened', {}, 'k-once'));
    await Promise.all([processDue(db), processDue(db)]);
    await processDue(db);
    expect(runs).toEqual(['ran']);
  });

  it('shows dead letters to settings managers and delivers them on retry', async () => {
    let broken = true;
    onEvent('test.happened', 'sometimes', async () => {
      if (broken) throw new Error('down');
      runs.push('delivered');
    });
    await db.$transaction((tx) => publish(tx, 'test.happened', {}, 'k-retry'));
    await db.eventDelivery.updateMany({ data: { attempts: 4 } });
    await processDue(db, new Date(Date.now() + 1000));
    const cookies = await signIn(app, 'owner@test.local', 'owner-pass-1');
    const list = await request(app.getHttpServer()).get('/events/dead').set('Cookie', cookies);
    expect(list.status).toBe(200);
    expect(list.body.rows).toHaveLength(1);
    const home = await request(app.getHttpServer()).get('/me/home').set('Cookie', cookies);
    expect(home.body.attention[0]).toMatchObject({ app: 'settings', text: 'home.deadEvents', values: { count: 1 } });
    broken = false;
    const { eventId, handler } = list.body.rows[0];
    const retry = await request(app.getHttpServer()).post(`/events/dead/${eventId}/${handler}/retry`).set('Cookie', cookies);
    expect(retry.status).toBe(200);
    await processDue(db);
    expect(runs).toEqual(['delivered']);
  });
});
