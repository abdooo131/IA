import { z } from 'zod';

const id = z.string().min(1).max(64);
const key = z.string().min(8).max(100);
const piastres = z.number().int().min(1).max(1_000_000_000);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_day');

export const PAYOUT_SCHEDULES = ['daily', 'twice_weekly', 'weekly'] as const;
export type PayoutScheduleName = (typeof PAYOUT_SCHEDULES)[number];

/** Staff count the cash a rider hands in. */
export const cashHandoverSchema = z.object({
  riderId: id,
  countedPiastres: z.number().int().min(0).max(1_000_000_000),
  note: z.string().trim().max(300).optional(),
  idempotencyKey: key,
});

export const reviewHandoverSchema = z.object({
  decision: z.enum(['write_off', 'charge_rider']),
  note: z.string().trim().min(3).max(300),
});

export const bankDepositSchema = z.object({
  darkStoreId: id,
  /** Which bank; empty uses the main bank (CIB, 1101) */
  bankAccountId: id.optional(),
  amountPiastres: piastres,
  reference: z.string().trim().min(2).max(100),
  idempotencyKey: key,
});

/** The cutoff is the end of a Cairo calendar day: everything up to it is paid. */
export const createPayoutSchema = z.object({
  merchantId: id,
  cutoffDay: day,
  note: z.string().trim().max(300).optional(),
});

export const duePayoutsSchema = z.object({ cutoffDay: day });

export const payoutPaidSchema = z.object({
  reference: z.string().trim().min(2).max(100),
  /** Which bank; empty uses the main bank (CIB, 1101) */
  bankAccountId: id.optional(),
});
export const payoutCancelSchema = z.object({ note: z.string().trim().min(3).max(300) });

export const merchantReceiptSchema = z.object({
  merchantId: id,
  /** Which bank; empty uses the main bank (CIB, 1101) */
  bankAccountId: id.optional(),
  amountPiastres: piastres,
  reference: z.string().trim().min(2).max(100),
  idempotencyKey: key,
});

/** Positive credits the merchant (we owe more), negative charges them. */
export const merchantAdjustmentSchema = z.object({
  merchantId: id,
  amountPiastres: z
    .number()
    .int()
    .min(-1_000_000_000)
    .max(1_000_000_000)
    .refine((v) => v !== 0, 'invalid_amount'),
  reason: z.string().trim().min(5).max(300),
  idempotencyKey: key,
});

export const riderBonusPayoutSchema = z.object({
  riderId: id,
  amountPiastres: piastres,
  from: z.enum(['bank', 'store_cash']),
  /** Which bank; empty uses the main bank (CIB, 1101) */
  bankAccountId: id.optional(),
  reference: z.string().trim().min(2).max(100),
  idempotencyKey: key,
});

export const payoutScheduleSchema = z.object({ payoutSchedule: z.enum(PAYOUT_SCHEDULES) });

/** Ledger entry kinds, for filters and labels. */
export const LEDGER_KINDS = [
  'cod_collected',
  'order_fee',
  'cod_fee',
  'failed_fee',
  'receiving_fee',
  'storage_fee',
  'rider_bonus',
  'cash_handover',
  'cash_difference',
  'bank_deposit',
  'merchant_payout',
  'merchant_receipt',
  'rider_bonus_payout',
  'adjustment',
  'return_fee',
  'damage_compensation',
  'damage_rider_charge',
  'money_transfer',
  'expense',
  'capital_in',
  'capital_out',
  'other_income',
  'journal',
] as const;
