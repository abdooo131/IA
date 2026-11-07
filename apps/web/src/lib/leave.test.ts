import { describe, expect, it } from 'vitest';
import {
  cairoClock,
  fmtDays,
  isWeekend,
  leftText,
  penaltyWords,
  shiftMonth,
  statusTone,
} from './leave';

describe('leave screens', () => {
  it('writes days without trailing zeros', () => {
    expect(fmtDays(2)).toBe('2');
    expect(fmtDays(1.5)).toBe('1.5');
    expect(fmtDays(0.25)).toBe('0.25');
    expect(leftText(-1)).toBe('0');
    expect(leftText(null)).toBe('');
  });

  it('moves between months across the year end', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-11', 0)).toBe('2026-11');
  });

  it('shades Friday and Saturday', () => {
    expect(isWeekend('2026-11-06')).toBe(true); // Friday
    expect(isWeekend('2026-11-07')).toBe(true); // Saturday
    expect(isWeekend('2026-11-08')).toBe(false); // Sunday
  });

  it('colours waiting, done and refused states apart', () => {
    expect(statusTone('pending_manager')).toBe('needs-action');
    expect(statusTone('appealed')).toBe('needs-action');
    expect(statusTone('approved')).toBe('delivered');
    expect(statusTone('final')).toBe('delivered');
    expect(statusTone('rejected')).toBe('danger');
  });

  it('describes a penalty step', () => {
    expect(penaltyWords({ penalty: 'deduction_days', days: 0.25, amountPiastres: null })).toEqual({
      key: 'deduction_days',
      values: { days: '0.25' },
    });
    expect(
      penaltyWords({ penalty: 'deduction_amount', days: null, amountPiastres: null }).key,
    ).toBe('deduction_amount_entered');
    expect(
      penaltyWords({ penalty: 'deduction_amount', days: null, amountPiastres: 125_050 }).values,
    ).toEqual({ amount: '1250.50' });
    expect(penaltyWords({ penalty: 'written_warning', days: null, amountPiastres: null }).key).toBe(
      'written_warning',
    );
  });

  it('shows a proposed time in Cairo', () => {
    expect(cairoClock('2026-11-02T07:00:00.000Z')).toBe('09:00');
    expect(cairoClock(null)).toBe('');
  });
});
