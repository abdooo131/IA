import type { PrismaClient } from '@prisma/client';
import { afterEach, describe, expect, it } from 'vitest';
import { installClock, restoreClock, setClock, simNow, withClock } from './clock';
import { loadDemo } from './index';

const RealDate = Date;

describe('demo clock', () => {
  afterEach(() => restoreClock());

  it('answers the simulated time, keeps instanceof Date and restores the real clock', async () => {
    const before = new Date();
    const start = RealDate.now() - 10 * 86_400_000;
    installClock(start);
    const now = new Date();
    expect(Math.abs(now.getTime() - start)).toBeLessThan(1000);
    expect(Math.abs(Date.now() - start)).toBeLessThan(1000);
    expect(now).toBeInstanceOf(Date);
    expect(before).toBeInstanceOf(Date);
    expect(new Date('2026-01-01T00:00:00Z').toISOString()).toBe('2026-01-01T00:00:00.000Z');

    // Each context keeps its own time.
    const a = withClock(start + 60_000, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return new Date().getTime();
    });
    const b = withClock(start + 120_000, async () => new Date().getTime());
    expect(Math.round(((await a) - start) / 1000)).toBe(60);
    expect(Math.round(((await b) - start) / 1000)).toBe(120);

    setClock(start + 3_600_000);
    expect(Math.round((simNow().getTime() - start) / 60_000)).toBe(60);
    restoreClock();
    expect(Math.abs(Date.now() - RealDate.now())).toBeLessThan(5);
    expect(Date).toBe(RealDate);
  });

  it('never runs ahead of the real time', () => {
    expect(() => installClock(RealDate.now() + 60_000)).toThrow(/real time/);
  });

  it('refuses to load demo data unless DEMO_LOAD is true', async () => {
    const saved = process.env.DEMO_LOAD;
    delete process.env.DEMO_LOAD;
    try {
      await expect(loadDemo({} as PrismaClient, { demoPassword: 'x' })).rejects.toThrow(
        /DEMO_LOAD/,
      );
    } finally {
      if (saved !== undefined) process.env.DEMO_LOAD = saved;
    }
  });
});
