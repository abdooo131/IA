import { z } from 'zod';

// Budgets are planned per quarter first (Q1 January to March ... Q4 October to December),
// then by month. A quarter's amount is split into its three months equally in whole
// piastres, the last month taking what is left over; each month can then be changed by hand
// and the quarter is always the sum of its months. Budgets are stored per month.

export const QUARTERS = [1, 2, 3, 4] as const;
export type Quarter = (typeof QUARTERS)[number];

/** The three months (YYYY-MM) of a quarter of a year. */
export function quarterMonths(year: number, quarter: number): [string, string, string] {
  const first = (quarter - 1) * 3 + 1;
  const m = (n: number) => `${year}-${String(n).padStart(2, '0')}`;
  return [m(first), m(first + 1), m(first + 2)];
}

/** The quarter (1 to 4) a month (YYYY-MM) falls in. */
export function quarterOfMonth(month: string): Quarter {
  return (Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1) as Quarter;
}

/** Splits a quarter's amount into three equal months; the last takes the remainder. */
export function splitQuarter(totalPiastres: number): [number, number, number] {
  if (!Number.isSafeInteger(totalPiastres) || totalPiastres < 0) throw new Error('invalid_amount');
  const each = Math.floor(totalPiastres / 3);
  return [each, each, totalPiastres - each * 2];
}

/** True when three months are exactly what splitting their total would give. */
export function isEvenSplit(months: readonly number[]): boolean {
  const total = months.reduce((s, m) => s + m, 0);
  const split = splitQuarter(total);
  return months.length === 3 && months.every((m, i) => m === split[i]);
}

/**
 * An amount raised (or lowered) by a percentage in basis points (1000 = 10%), in whole
 * piastres rounded half up, never below zero. Integer arithmetic only.
 */
export function scaleBudget(amountPiastres: number, percentBp: number): number {
  const scaled = BigInt(amountPiastres) * BigInt(10_000 + percentBp);
  const whole = scaled / 10_000n;
  const rest = scaled % 10_000n;
  const rounded = rest * 2n >= 10_000n ? whole + 1n : whole;
  return rounded < 0n ? 0 : Number(rounded);
}

/** Variance as a share of the budget in basis points, or null without a budget. */
export function variancePercentBp(variancePiastres: number, budgetPiastres: number) {
  if (!budgetPiastres) return null;
  return Math.round((variancePiastres * 10_000) / budgetPiastres);
}

/** Budget scope: every store and the company wide part together, only company wide, or a store. */
export type BudgetScope = 'all' | 'company' | string;

const year = z.number().int().min(2020).max(2100);
const amount = z.number().int().min(0).max(3_000_000_000);
const cuid = z.string().min(1).max(64);

export const budgetQuarterSchema = z.object({
  year,
  quarter: z.number().int().min(1).max(4),
  accountId: cuid,
  darkStoreId: cuid.optional(),
  amountPiastres: amount,
});

export const budgetCopySchema = z
  .object({
    fromYear: year,
    toYear: year,
    /** 'all' (every store and company wide), 'company' or a store id */
    scope: z.string().min(1).max(64).default('all'),
    /** Raise (or lower) every amount by this share in basis points: 500 = 5% */
    percentBp: z.number().int().min(-10_000).max(100_000).default(0),
    /** Replace a budget the target year already has in that scope */
    replace: z.boolean().default(false),
  })
  .refine((v) => v.fromYear !== v.toYear, { path: ['toYear'], message: 'same_year' });
