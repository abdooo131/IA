import { z } from 'zod';
import { addDays } from './hours';
import { normalizeEgyptianPhone } from './phone';

// Rider pay (CLAUDE.md "Rider pay"): riders earn a fixed amount per delivered order (the
// setting rider.bonus_per_delivery_piastres, per store) and nothing else. Each earning is held
// for rider.withdraw_hold_working_days working days after its delivery day (weekend days and
// official holidays do not count) and becomes available at the start of the next Cairo day.
// What the rider owes the company is taken first: available already nets it.
//
//   available = matured earnings − paid out − owed − pending withdrawals (what they receive)
//
// Everything is summed from the ledger (rider_bonus lines with their day), never stored.

export const PAY_BASES = ['monthly_salary', 'per_delivery'] as const;
export type PayBasis = (typeof PAY_BASES)[number];

export const payBasisSchema = z.object({ payBasis: z.enum(PAY_BASES) });

export const WITHDRAWAL_METHODS = ['store_cash', 'instapay', 'mobile_wallet', 'bank'] as const;
export type WithdrawalMethod = (typeof WITHDRAWAL_METHODS)[number];

export const MOBILE_WALLETS = ['vodafone_cash', 'etisalat_cash', 'orange_cash', 'we_pay'] as const;
export type MobileWallet = (typeof MOBILE_WALLETS)[number];

export const WITHDRAWAL_STATUSES = [
  'requested',
  'approved',
  'paid',
  'rejected',
  'cancelled',
] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];
/** Requests that still hold part of the wallet. */
export const OPEN_WITHDRAWAL_STATUSES: WithdrawalStatus[] = ['requested', 'approved'];

/** RW-000001 */
export const withdrawalNumber = (n: number) => `RW-${String(n).padStart(6, '0')}`;

const mobile = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const phone = normalizeEgyptianPhone(v);
    if (!phone) {
      ctx.addIssue({ code: 'custom', message: 'invalid_phone' });
      return z.NEVER;
    }
    return phone;
  });

/** An InstaPay address (name@instapay) or the Egyptian mobile linked to it. */
const instapayHandle = z
  .string()
  .trim()
  .max(60)
  .transform((v, ctx) => {
    if (/^[a-z0-9._-]{2,40}@instapay$/i.test(v)) return v.toLowerCase();
    const phone = normalizeEgyptianPhone(v);
    if (phone) return phone;
    ctx.addIssue({ code: 'custom', message: 'invalid_instapay' });
    return z.NEVER;
  });

const iban = z
  .string()
  .trim()
  .toUpperCase()
  .transform((v) => v.replace(/\s+/g, ''))
  .refine((v) => /^EG\d{27}$/.test(v), 'invalid_iban');

/** Where the rider wants the money, by method. */
export const withdrawalDetailsSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('store_cash') }),
  z.object({ method: z.literal('instapay'), handle: instapayHandle }),
  z.object({
    method: z.literal('mobile_wallet'),
    provider: z.enum(MOBILE_WALLETS),
    phone: mobile,
  }),
  z.object({
    method: z.literal('bank'),
    bankName: z.string().trim().min(2).max(80),
    iban,
    holder: z.string().trim().min(2).max(120),
  }),
]);
export type WithdrawalDetails = z.infer<typeof withdrawalDetailsSchema>;

/** POST /rider/withdrawals: what the rider receives (after deductions) and how. */
export const withdrawalRequestSchema = z.object({
  amountPiastres: z.number().int().min(1).max(1_000_000_000),
  details: withdrawalDetailsSchema,
  idempotencyKey: z.string().min(8).max(100),
});
export type WithdrawalRequestBody = z.infer<typeof withdrawalRequestSchema>;

export const withdrawalRejectSchema = z.object({
  reason: z.string().trim().min(3).max(300),
});

/** Paying it: the bank or cash box it comes from (default: the store's box for cash at the
 * store, else the main bank) and the transfer or receipt reference. */
export const withdrawalPaySchema = z.object({
  moneyAccountId: z.string().min(1).max(64).optional(),
  reference: z.string().trim().min(2).max(100),
});

// ─── working days ──────────────────────────────────────────────────────────────

/**
 * The weekend days of rider.weekend_days: each digit is a JavaScript weekday of the Cairo date
 * (0 Sunday … 6 Saturday). 5 is Friday, 56 Friday and Saturday; write Sunday last (50).
 */
export function weekendDays(setting: number): number[] {
  const digits = String(Math.max(0, Math.trunc(setting)))
    .split('')
    .map(Number)
    .filter((d) => d >= 0 && d <= 6);
  return [...new Set(digits)];
}

/** The JavaScript weekday (0 Sunday) of a Cairo calendar day YYYY-MM-DD. */
export function weekdayOf(day: string) {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

export interface HoldRules {
  holdDays: number;
  weekend: number[];
  /** Official holidays, YYYY-MM-DD */
  holidays: ReadonlySet<string>;
}

/**
 * The Cairo day an earning made on `day` becomes available: the hold counts working days
 * after the delivery day (weekend days and official holidays skipped); it is available from
 * the start of the day after the last of them. With no hold it is available the next day.
 */
export function availableFrom(day: string, rules: HoldRules): string {
  let d = day;
  let left = Math.max(0, rules.holdDays);
  // A whole year of non working days cannot happen; the guard stops a bad setting looping.
  for (let guard = 0; left > 0 && guard < 3660; guard++) {
    d = addDays(d, 1);
    if (rules.weekend.includes(weekdayOf(d)) || rules.holidays.has(d)) continue;
    left--;
  }
  return addDays(d, 1);
}

export interface WalletEarning {
  amountPiastres: number;
  /** Cairo day it was earned (the delivery day) */
  day: string;
  /** Cairo day it becomes available */
  availableOn: string;
}

/** The wallet's figures on a Cairo day, from its earnings and what left it. */
export function walletTotals(input: {
  today: string;
  earnings: WalletEarning[];
  /** Paid out of the wallet (withdrawals and earlier payouts, deductions included) */
  paidPiastres: number;
  /** What the rider owes: dues plus a staff advance (never below zero) */
  owedPiastres: number;
  /** Open withdrawals: what the rider will receive */
  pendingPiastres: number;
  /** Deductions already set aside by the open withdrawals */
  pendingDeductionPiastres?: number;
}) {
  const month = input.today.slice(0, 7);
  let earnedAll = 0;
  let earnedMonth = 0;
  let matured = 0;
  for (const e of input.earnings) {
    earnedAll += e.amountPiastres;
    if (e.day.slice(0, 7) === month) earnedMonth += e.amountPiastres;
    if (e.availableOn <= input.today) matured += e.amountPiastres;
  }
  const onHold = earnedAll - matured;
  const owed = Math.max(0, input.owedPiastres);
  const available = Math.max(0, matured - input.paidPiastres - owed - input.pendingPiastres);
  return {
    earnedAllPiastres: earnedAll,
    earnedMonthPiastres: earnedMonth,
    onHoldPiastres: onHold,
    maturedPiastres: matured,
    paidPiastres: input.paidPiastres,
    /** Owed and not yet set aside by an open withdrawal */
    owedPiastres: Math.max(0, owed - (input.pendingDeductionPiastres ?? 0)),
    pendingPiastres: input.pendingPiastres,
    availablePiastres: available,
    /** Still in the wallet, held or not (earned − paid) */
    balancePiastres: earnedAll - input.paidPiastres,
  };
}
export type WalletTotals = ReturnType<typeof walletTotals>;

/**
 * What a withdrawal takes back from the wallet for what the rider owes, in order: dues
 * (cash shortages, damage, penalties) first, then a staff advance.
 */
export function withdrawalDeductions(owed: { duesPiastres: number; advancePiastres: number }) {
  const dues = Math.max(0, owed.duesPiastres);
  const advance = Math.max(0, owed.advancePiastres);
  return { duesPiastres: dues, advancePiastres: advance, totalPiastres: dues + advance };
}
