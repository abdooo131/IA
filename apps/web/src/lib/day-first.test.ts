import { describe, expect, it } from 'vitest';
import { dayFirstToIso, isoToDayFirst } from './day-first';
import { durationParts } from './duration';

describe('day first dates', () => {
  it('reads dd/mm/yyyy and writes it back', () => {
    expect(dayFirstToIso('28/10/2026')).toBe('2026-10-28');
    expect(dayFirstToIso('1-2-2026')).toBe('2026-02-01');
    expect(isoToDayFirst('2026-11-01')).toBe('01/11/2026');
  });

  it('refuses dates that do not exist', () => {
    expect(dayFirstToIso('31/02/2026')).toBeNull();
    expect(dayFirstToIso('10/28/2026')).toBeNull();
    expect(dayFirstToIso('soon')).toBeNull();
  });
});

describe('late and due times', () => {
  it('ticks minutes, then hours, then days', () => {
    expect(durationParts(-(2 * 60 + 58) * 1000)).toEqual({
      key: 'durationMinutes',
      vars: { m: 2, ss: '58' },
    });
    expect(durationParts(7 * 3600_000 + 7 * 60_000)).toEqual({
      key: 'durationHours',
      vars: { h: 7, m: 7 },
    });
    expect(durationParts(-(4 * 86_400_000 + 18 * 3600_000))).toEqual({
      key: 'durationDays',
      vars: { d: 4, h: 18 },
    });
  });
});
