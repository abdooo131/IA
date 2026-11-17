import { describe, expect, it } from 'vitest';
import { comparisonRange, presetRange } from './report-period';

const previous = (from: string, to: string) => comparisonRange({ from, to }, 'previous');

describe('comparing with the previous period', () => {
  it('moves a quarter to date back one quarter, the same number of days into it', () => {
    // 41 days into the fourth quarter: 41 days into the third.
    expect(previous('2026-10-01', '2026-11-10')).toEqual({ from: '2026-07-01', to: '2026-08-10' });
    expect(presetRange('this_quarter', '2026-11-10')).toEqual({
      from: '2026-10-01',
      to: '2026-11-10',
    });
    // 50 days into the second quarter: 50 days into the first (19 February).
    expect(previous('2026-04-01', '2026-05-20')).toEqual({ from: '2026-01-01', to: '2026-02-19' });
    // Never past the end of the quarter before.
    expect(previous('2026-01-01', '2026-03-30')).toEqual({ from: '2025-10-01', to: '2025-12-28' });
    expect(previous('2026-04-01', '2026-06-30')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    // Ending on a month's last day keeps the month's last day.
    expect(previous('2026-10-01', '2026-11-30')).toEqual({ from: '2026-07-01', to: '2026-08-31' });
    expect(previous('2026-10-01', '2026-12-31')).toEqual({ from: '2026-07-01', to: '2026-09-30' });
  });

  it('moves a year to date back one year', () => {
    expect(previous('2026-01-01', '2026-11-10')).toEqual({ from: '2025-01-01', to: '2025-11-10' });
    expect(previous('2026-01-01', '2026-04-30')).toEqual({ from: '2025-01-01', to: '2025-04-30' });
    expect(previous('2025-01-01', '2025-12-31')).toEqual({ from: '2024-01-01', to: '2024-12-31' });
  });

  it('keeps whole months and a month to date as they were', () => {
    expect(previous('2026-11-01', '2026-11-07')).toEqual({ from: '2026-10-01', to: '2026-10-07' });
    // Last month in November starts on a quarter's first day: still the month before.
    expect(previous('2026-10-01', '2026-10-31')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(previous('2026-10-01', '2026-10-15')).toEqual({ from: '2026-09-01', to: '2026-09-15' });
    expect(previous('2026-03-01', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(previous('2026-02-01', '2026-03-31')).toEqual({ from: '2025-12-01', to: '2026-01-31' });
    expect(previous('2026-11-01', '2027-01-15')).toEqual({ from: '2026-08-01', to: '2026-10-15' });
  });

  it('moves other ranges back by their own length, and last year by a year', () => {
    expect(previous('2026-10-10', '2026-10-16')).toEqual({ from: '2026-10-03', to: '2026-10-09' });
    expect(comparisonRange({ from: '2026-01-01', to: '2026-11-10' }, 'last_year')).toEqual({
      from: '2025-01-01',
      to: '2025-11-10',
    });
  });
});
