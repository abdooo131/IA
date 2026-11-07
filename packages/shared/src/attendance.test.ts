import { describe, expect, it } from 'vitest';
import { distanceMeters, shiftSchema } from './attendance';
import { cairoAt } from './hours';

describe('attendance helpers', () => {
  it('measures distances in metres', () => {
    expect(distanceMeters({ lat: 30, lng: 31 }, { lat: 30, lng: 31 })).toBe(0);
    // One thousandth of a degree of latitude is about 111 m.
    expect(distanceMeters({ lat: 30, lng: 31 }, { lat: 30.001, lng: 31 })).toBe(111);
  });

  it('turns a Cairo wall clock time into an instant, in winter and summer time', () => {
    expect(cairoAt('2026-01-14', 600).toISOString()).toBe('2026-01-14T08:00:00.000Z');
    expect(cairoAt('2026-07-14', 600).toISOString()).toBe('2026-07-14T07:00:00.000Z');
    // Past midnight falls on the next day.
    expect(cairoAt('2026-01-14', 1440 + 360).toISOString()).toBe('2026-01-15T04:00:00.000Z');
  });

  it('checks shift times and days', () => {
    const base = {
      nameEn: 'Morning',
      start: '10:00',
      end: '16:00',
      breakMinutes: 30,
      weekdays: [0, 1],
      overnight: false,
    };
    expect(shiftSchema.safeParse(base).success).toBe(true);
    expect(shiftSchema.safeParse({ ...base, start: '25:00' }).success).toBe(false);
    expect(shiftSchema.safeParse({ ...base, weekdays: [] }).success).toBe(false);
  });
});
