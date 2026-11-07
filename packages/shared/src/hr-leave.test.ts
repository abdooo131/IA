import { describe, expect, it } from 'vitest';
import {
  appealOpen,
  carryOver,
  correctionRequestSchema,
  countedMonths,
  dayDeduction,
  ladderStep,
  leaveYearOf,
  leaveYearRange,
  prorate,
  recordViolationSchema,
  violationStepSchema,
  workingDays,
} from './hr-leave';

describe('leave years', () => {
  it('names a leave year by the year it starts in', () => {
    expect(leaveYearOf('2026-03-10', 1)).toBe(2026);
    expect(leaveYearOf('2026-03-10', 7)).toBe(2025);
    expect(leaveYearOf('2026-07-01', 7)).toBe(2026);
    expect(leaveYearRange(2026, 1)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(leaveYearRange(2026, 7)).toEqual({ from: '2026-07-01', to: '2027-06-30' });
  });

  it('prorates a joiner by whole months and accrues monthly when asked', () => {
    const base = { year: 2026, startMonth: 1, asOf: '2026-11-07' };
    expect(countedMonths({ ...base, hireDate: null, monthly: false })).toBe(12);
    expect(countedMonths({ ...base, hireDate: '2026-04-20', monthly: false })).toBe(9);
    expect(countedMonths({ ...base, hireDate: null, monthly: true })).toBe(11);
    expect(countedMonths({ ...base, hireDate: '2026-10-02', monthly: true })).toBe(2);
    expect(countedMonths({ ...base, hireDate: '2027-01-05', monthly: false })).toBe(0);
    expect(prorate(21, 12)).toBe(21);
    expect(prorate(21, 9)).toBe(15.5); // 15.75 rounded down to a half day
    expect(prorate(21, 0)).toBe(0);
    expect(carryOver(4.5, 3)).toBe(3);
    expect(carryOver(-2, 3)).toBe(0);
  });
});

describe('working days', () => {
  it('counts shifts, skips days off and holidays, and falls back to the default week', () => {
    const roster = new Map([
      ['2026-11-01', true],
      ['2026-11-02', false],
    ]);
    const days = workingDays({
      from: '2026-11-01',
      to: '2026-11-07',
      holidays: new Set(['2026-11-04']),
      roster,
      defaultWeekdays: [0, 1, 2, 3, 4], // Sunday to Thursday
    });
    // 1 Nov is a Sunday (shift), 2 Nov a day off, 3 Nov Tuesday (default), 4 Nov a holiday,
    // 5 Nov Thursday (default), 6 and 7 Nov Friday and Saturday (weekend).
    expect(days).toEqual(['2026-11-01', '2026-11-03', '2026-11-05']);
  });
});

describe('violations', () => {
  it('climbs the ladder and stays on its last step', () => {
    expect(ladderStep(0, 4)).toBe(1);
    expect(ladderStep(2, 4)).toBe(3);
    expect(ladderStep(9, 4)).toBe(4);
    expect(ladderStep(3, 1)).toBe(1);
  });

  it('takes a day of pay as basic over the payroll days, to the piastre', () => {
    expect(dayDeduction(900_000, 1, 30)).toBe(30_000);
    expect(dayDeduction(900_000, 0.25, 30)).toBe(7_500);
    expect(dayDeduction(1_000_000, 0.5, 30)).toBe(16_667);
  });

  it('keeps the appeal window open for hr.appeal_days', () => {
    const at = new Date('2026-11-01T10:00:00Z');
    expect(appealOpen(at, new Date('2026-11-03T10:00:00Z'), 3)).toBe(true);
    expect(appealOpen(at, new Date('2026-11-04T10:00:00Z'), 3)).toBe(false);
  });

  it('checks ladder steps and a changed step needs a reason', () => {
    expect(violationStepSchema.safeParse({ penalty: 'deduction_days', days: 0.25 }).success).toBe(
      true,
    );
    expect(violationStepSchema.safeParse({ penalty: 'deduction_days' }).success).toBe(false);
    expect(violationStepSchema.safeParse({ penalty: 'deduction_days', days: 0.3 }).success).toBe(
      false,
    );
    expect(
      violationStepSchema.safeParse({ penalty: 'written_warning', amountPiastres: 5 }).success,
    ).toBe(false);
    const base = {
      employeeId: 'e',
      typeId: 't',
      occurredOn: '2026-11-01',
      description: 'Late again',
      idempotencyKey: 'key-12345678',
    };
    expect(recordViolationSchema.safeParse(base).success).toBe(true);
    expect(recordViolationSchema.safeParse({ ...base, step: 2 }).success).toBe(false);
    expect(
      recordViolationSchema.safeParse({ ...base, step: 2, stepReason: 'Agreed with HR' }).success,
    ).toBe(true);
  });

  it('needs at least one proposed time on a correction', () => {
    const base = { day: '2026-11-01', problem: 'Phone died', idempotencyKey: 'key-12345678' };
    expect(correctionRequestSchema.safeParse(base).success).toBe(false);
    expect(correctionRequestSchema.safeParse({ ...base, proposedIn: '09:55' }).success).toBe(true);
    expect(correctionRequestSchema.safeParse({ ...base, proposedIn: '25:00' }).success).toBe(false);
  });
});
