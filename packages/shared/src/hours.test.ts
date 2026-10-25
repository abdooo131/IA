import { describe, expect, it } from 'vitest';
import {
  addDays,
  cairoDay,
  cairoDayStart,
  cairoClock,
  type DayHours,
  formatMinute,
  isOpenAt,
  nextOpeningAt,
  parseMinute,
} from './hours';

const every = (opensMinute: number, closesMinute: number): DayHours[] =>
  Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    opensMinute,
    closesMinute,
    isClosed: false,
  }));

// Cairo is UTC+2 in winter and UTC+3 in summer (DST since 2023). January keeps it simple.
const cairo = (iso: string) => new Date(`${iso}+02:00`);

describe('cairoClock', () => {
  it('reads weekday and minute in Cairo time', () => {
    // Wednesday 2026-01-14 23:30 UTC is Thursday 01:30 in Cairo
    expect(cairoClock(new Date('2026-01-14T23:30:00Z'))).toEqual({ weekday: 4, minute: 90 });
  });
});

describe('isOpenAt', () => {
  const tenToMidnight = every(600, 1440);

  it('is open inside the hours and closed outside', () => {
    expect(isOpenAt(tenToMidnight, cairo('2026-01-14T10:00:00'))).toBe(true);
    expect(isOpenAt(tenToMidnight, cairo('2026-01-14T23:59:00'))).toBe(true);
    expect(isOpenAt(tenToMidnight, cairo('2026-01-14T09:59:00'))).toBe(false);
    expect(isOpenAt(tenToMidnight, cairo('2026-01-15T00:00:00'))).toBe(false);
  });

  it('handles hours that run past midnight', () => {
    const tenToTwo = every(600, 26 * 60);
    expect(isOpenAt(tenToTwo, cairo('2026-01-15T01:30:00'))).toBe(true);
    expect(isOpenAt(tenToTwo, cairo('2026-01-15T02:00:00'))).toBe(false);
  });

  it('respects a closed day, including its after midnight tail', () => {
    const hours = every(600, 26 * 60).map((d) => (d.weekday === 3 ? { ...d, isClosed: true } : d));
    // Wednesday (3) closed all day
    expect(isOpenAt(hours, cairo('2026-01-14T12:00:00'))).toBe(false);
    // Thursday 01:00 would be Wednesday's tail, which is closed
    expect(isOpenAt(hours, cairo('2026-01-15T01:00:00'))).toBe(false);
  });
});

describe('nextOpeningAt', () => {
  it('finds later today, then tomorrow', () => {
    const hours = every(600, 1440);
    expect(nextOpeningAt(hours, cairo('2026-01-14T08:00:00'))?.toISOString()).toBe(
      '2026-01-14T08:00:00.000Z',
    );
    expect(nextOpeningAt(hours, cairo('2026-01-14T23:00:00'))?.toISOString()).toBe(
      '2026-01-15T08:00:00.000Z',
    );
  });

  it('skips closed days and returns null when never open', () => {
    const hours = every(600, 1440).map((d) => (d.weekday === 4 ? { ...d, isClosed: true } : d));
    // Wednesday night: Thursday is closed, so Friday 10:00
    expect(nextOpeningAt(hours, cairo('2026-01-14T23:00:00'))?.toISOString()).toBe(
      '2026-01-16T08:00:00.000Z',
    );
    expect(
      nextOpeningAt(
        every(600, 1440).map((d) => ({ ...d, isClosed: true })),
        new Date(),
      ),
    ).toBeNull();
  });
});

describe('minute formatting', () => {
  it('round trips', () => {
    expect(formatMinute(600)).toBe('10:00');
    expect(formatMinute(1440)).toBe('00:00');
    expect(formatMinute(26 * 60 + 5)).toBe('02:05');
    expect(parseMinute('09:30')).toBe(570);
    expect(parseMinute('24:00')).toBeNull();
  });
});

describe('Cairo days', () => {
  it('starts days at Cairo midnight in winter and in summer time', () => {
    expect(cairoDayStart('2026-01-14').toISOString()).toBe('2026-01-13T22:00:00.000Z');
    expect(cairoDayStart('2026-07-14').toISOString()).toBe('2026-07-13T21:00:00.000Z');
    expect(cairoDay(new Date('2026-07-13T21:30:00Z'))).toBe('2026-07-14');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});
