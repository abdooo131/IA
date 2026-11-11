import { describe, expect, it } from 'vitest';
import {
  budgetCopySchema,
  isEvenSplit,
  quarterMonths,
  quarterOfMonth,
  scaleBudget,
  splitQuarter,
  variancePercentBp,
} from './budgets';

describe('budget quarters', () => {
  it('names the months of each quarter', () => {
    expect(quarterMonths(2027, 1)).toEqual(['2027-01', '2027-02', '2027-03']);
    expect(quarterMonths(2027, 4)).toEqual(['2027-10', '2027-11', '2027-12']);
    expect(quarterOfMonth('2027-03')).toBe(1);
    expect(quarterOfMonth('2027-04')).toBe(2);
    expect(quarterOfMonth('2027-09')).toBe(3);
    expect(quarterOfMonth('2027-12')).toBe(4);
  });

  it('splits a quarter equally, the last month taking the rounding', () => {
    expect(splitQuarter(300_000)).toEqual([100_000, 100_000, 100_000]);
    expect(splitQuarter(100)).toEqual([33, 33, 34]);
    expect(splitQuarter(101)).toEqual([33, 33, 35]);
    expect(splitQuarter(2)).toEqual([0, 0, 2]);
    expect(splitQuarter(0)).toEqual([0, 0, 0]);
    for (const total of [1, 7, 99_999, 1_000_000_001]) {
      expect(splitQuarter(total).reduce((s, m) => s + m, 0)).toBe(total);
    }
    expect(() => splitQuarter(1.5)).toThrow();
    expect(() => splitQuarter(-3)).toThrow();
  });

  it('tells an even split from months changed by hand', () => {
    expect(isEvenSplit([33, 33, 34])).toBe(true);
    expect(isEvenSplit([34, 33, 33])).toBe(false);
    expect(isEvenSplit([0, 0, 0])).toBe(true);
  });

  it('scales by a percentage in whole piastres, half up', () => {
    expect(scaleBudget(100_000, 1_000)).toBe(110_000);
    expect(scaleBudget(15, 1_000)).toBe(17); // 16.5 rounds up
    expect(scaleBudget(14, 1_000)).toBe(15); // 15.4
    expect(scaleBudget(100, -500)).toBe(95);
    expect(scaleBudget(100, -10_000)).toBe(0);
    expect(scaleBudget(3_000_000_000, 0)).toBe(3_000_000_000);
  });

  it('gives the variance as a share of the budget', () => {
    expect(variancePercentBp(500, 1_000)).toBe(5_000);
    expect(variancePercentBp(-1, 3)).toBe(-3_333);
    expect(variancePercentBp(500, 0)).toBeNull();
  });

  it('refuses copying a year onto itself', () => {
    expect(budgetCopySchema.safeParse({ fromYear: 2026, toYear: 2026 }).success).toBe(false);
    expect(budgetCopySchema.parse({ fromYear: 2026, toYear: 2027 })).toMatchObject({
      scope: 'all',
      percentBp: 0,
      replace: false,
    });
  });
});
