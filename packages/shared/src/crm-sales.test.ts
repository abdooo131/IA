import { describe, expect, it } from 'vitest';
import {
  commissionMonthIndex,
  commissionOn,
  commissionOutcome,
  qualifyingMonth,
  targetGap,
} from './crm-sales';

const egp = (n: number) => n * 100;

describe('sales commission rules', () => {
  it('hits at or above a target above 0 and pays the rate on all counted fees', () => {
    // The owner's example: target 500,000 EGP.
    expect(commissionOutcome(egp(520_000), egp(500_000))).toBe('hit');
    expect(commissionOn(egp(520_000), 500)).toBe(egp(26_000));
    expect(commissionOutcome(egp(500_000), egp(500_000))).toBe('hit');
    expect(commissionOutcome(egp(480_000), egp(500_000))).toBe('missed');
    expect(targetGap(egp(480_000), egp(500_000))).toBe(egp(20_000));
    expect(targetGap(egp(520_000), egp(500_000))).toBe(0);
    expect(commissionOutcome(egp(480_000), null)).toBe('no_target');
    expect(commissionOutcome(egp(480_000), 0)).toBe('no_target');
    expect(targetGap(1, null)).toBeNull();
  });

  it('qualifies a merchant in its nth distinct active month', () => {
    expect(qualifyingMonth([], 2)).toBeNull();
    expect(qualifyingMonth(['2026-03'], 2)).toBeNull();
    expect(qualifyingMonth(['2026-05', '2026-03', '2026-03'], 2)).toBe('2026-05');
    expect(qualifyingMonth(['2026-03'], 1)).toBe('2026-03');
  });

  it('counts commission months from the win month, 0 meaning no end', () => {
    expect(commissionMonthIndex('2026-01', '2026-01', 12)).toBe(1);
    expect(commissionMonthIndex('2026-01', '2026-12', 12)).toBe(12);
    expect(commissionMonthIndex('2026-01', '2027-01', 12)).toBeNull();
    expect(commissionMonthIndex('2026-01', '2025-12', 12)).toBeNull();
    expect(commissionMonthIndex('2026-01', '2030-01', 0)).toBe(49);
  });
});
