import { describe, expect, it } from 'vitest';
import {
  availableFrom,
  hireSteps,
  walletTotals,
  weekdayOf,
  weekendDays,
  withdrawalDeductions,
  withdrawalRequestSchema,
} from './index';

describe('rider pay hold', () => {
  const rules = { holdDays: 5, weekend: [5], holidays: new Set<string>() };

  it('counts working days after the delivery day, skipping Fridays', () => {
    // 2026-11-01 is a Sunday: Mon to Thu are 4 working days, Friday is skipped, Saturday is
    // the 5th, so it is available from Sunday 2026-11-08.
    expect(weekdayOf('2026-11-01')).toBe(0);
    expect(availableFrom('2026-11-01', rules)).toBe('2026-11-08');
    // Delivered on a Friday: Sat, Sun, Mon, Tue, Wed → available Thursday.
    expect(availableFrom('2026-11-06', rules)).toBe('2026-11-12');
  });

  it('skips official holidays too', () => {
    const withHoliday = { ...rules, holidays: new Set(['2026-11-03']) };
    expect(availableFrom('2026-11-01', withHoliday)).toBe('2026-11-09');
  });

  it('frees the next day with no hold, and reads weekend digits', () => {
    expect(availableFrom('2026-11-01', { ...rules, holdDays: 0 })).toBe('2026-11-02');
    expect(weekendDays(5)).toEqual([5]);
    expect(weekendDays(56)).toEqual([5, 6]);
    expect(weekendDays(50)).toEqual([5, 0]);
  });
});

describe('wallet totals', () => {
  const earnings = [
    { amountPiastres: 3000, day: '2026-10-20', availableOn: '2026-10-27' },
    { amountPiastres: 3000, day: '2026-11-02', availableOn: '2026-11-09' },
    { amountPiastres: 3000, day: '2026-11-05', availableOn: '2026-11-12' },
  ];

  it('nets what is owed, paid and pending out of matured earnings', () => {
    const t = walletTotals({
      today: '2026-11-10',
      earnings,
      paidPiastres: 1000,
      owedPiastres: 1500,
      pendingPiastres: 2000,
      pendingDeductionPiastres: 500,
    });
    expect(t).toMatchObject({
      earnedAllPiastres: 9000,
      earnedMonthPiastres: 6000,
      onHoldPiastres: 3000,
      maturedPiastres: 6000,
      // 6000 − 1000 paid − 1500 owed − 2000 pending
      availablePiastres: 1500,
      // 500 of what is owed is already set aside by the open request
      owedPiastres: 1000,
      balancePiastres: 8000,
    });
  });

  it('never shows less than zero available', () => {
    const t = walletTotals({
      today: '2026-11-10',
      earnings,
      paidPiastres: 0,
      owedPiastres: 50_000,
      pendingPiastres: 0,
    });
    expect(t.availablePiastres).toBe(0);
  });

  it('takes dues before an advance', () => {
    expect(withdrawalDeductions({ duesPiastres: 200, advancePiastres: -5 })).toEqual({
      duesPiastres: 200,
      advancePiastres: 0,
      totalPiastres: 200,
    });
  });
});

describe('withdrawal request', () => {
  const body = (details: unknown) => ({
    amountPiastres: 10_000,
    details,
    idempotencyKey: 'k-12345678',
  });

  it('checks each method', () => {
    expect(withdrawalRequestSchema.safeParse(body({ method: 'store_cash' })).success).toBe(true);
    expect(
      withdrawalRequestSchema.parse(body({ method: 'instapay', handle: 'Ali@InstaPay' })).details,
    ).toEqual({ method: 'instapay', handle: 'ali@instapay' });
    expect(
      withdrawalRequestSchema.parse(
        body({ method: 'mobile_wallet', provider: 'vodafone_cash', phone: '01012345678' }),
      ).details,
    ).toEqual({ method: 'mobile_wallet', provider: 'vodafone_cash', phone: '+201012345678' });
    expect(
      withdrawalRequestSchema.safeParse(
        body({ method: 'bank', bankName: 'CIB', iban: 'EG12', holder: 'Ali' }),
      ).success,
    ).toBe(false);
    expect(
      withdrawalRequestSchema.safeParse(
        body({
          method: 'bank',
          bankName: 'CIB',
          iban: `EG${'1'.repeat(27)}`,
          holder: 'Ali Hassan',
        }),
      ).success,
    ).toBe(true);
    expect(
      withdrawalRequestSchema.safeParse(body({ method: 'instapay', handle: 'nope' })).success,
    ).toBe(false);
  });
});

describe('hire wizard for riders paid per delivery', () => {
  it('skips the pay step', () => {
    expect(
      hireSteps({ canPay: true, employment: 'employee', payBasis: 'per_delivery' }),
    ).not.toContain('pay');
    expect(
      hireSteps({ canPay: true, employment: 'employee', payBasis: 'monthly_salary' }),
    ).toContain('pay');
  });
});
