import { z } from 'zod';
import { isCalendarDay } from './hours';

const id = z.string().min(1).max(64);
const key = z.string().min(8).max(100);
const piastres = z.number().int().min(1).max(1_000_000_000);
const day = z.string().refine(isCalendarDay, 'invalid_day');

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
  receiptPhotoId: id.optional(),
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
  /** The bank transfer slip photo, uploaded first */
  receiptPhotoId: id.optional(),
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
  receiptPhotoId: id.optional(),
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

export const payoutScheduleSchema = z.object({ payoutSchedule: z.enum(PAYOUT_SCHEDULES) });

/** Ledger entry kinds, for filters and labels. */
export const LEDGER_KINDS = [
  'cod_collected',
  'shipping_fee',
  'product_handling',
  'packaging_charge',
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
  'rider_shortage_charge',
  'rider_penalty',
  'rider_withdrawal',
  'money_transfer',
  'expense',
  'capital_in',
  'capital_out',
  'other_income',
  'journal',
] as const;

/** Close the books through a Cairo day; a reason is needed to move the date back. */
export const closeBooksSchema = z.object({
  day,
  reason: z.string().trim().max(300).optional(),
});

/** A second person approves or rejects a waiting request (a note is needed to reject). */
export const decideRequestSchema = z.object({
  approve: z.boolean(),
  note: z.string().trim().max(300).optional(),
});

/** A receipt photo for exactly one entry, payout or request. */
export const attachReceiptSchema = z
  .object({
    photoId: id,
    entryId: id.optional(),
    payoutId: id.optional(),
    requestId: id.optional(),
  })
  .refine((v) => [v.entryId, v.payoutId, v.requestId].filter(Boolean).length === 1, {
    message: 'one_target',
  });

/** Starting balances, as an accountant reads them (positive on the account's normal side). */
export const openingBalancesSchema = z.object({
  day,
  lines: z
    .array(
      z.object({
        accountId: id,
        amountPiastres: z.number().int().min(-1_000_000_000).max(1_000_000_000),
      }),
    )
    .min(1)
    .max(500),
});

/** A bonus to an outsourced person; with commissionId it pays an approved sales commission. */
export const staffBonusSchema = advanceSchemaBase().extend({ commissionId: id.optional() });

function advanceSchemaBase() {
  return z.object({
    userId: id,
    amountPiastres: piastres,
    moneyAccountId: id,
    reference: z.string().trim().min(2).max(100),
    day: day.optional(),
    idempotencyKey: key,
    receiptPhotoId: id.optional(),
  });
}
export const advanceSchema = advanceSchemaBase();

/** The month's salaries (YYYY-MM): everyone paid, with deductions and advance recovery. */
export const payrollSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'invalid_month'),
  moneyAccountId: id,
  lines: z
    .array(
      z.object({
        userId: id,
        grossPiastres: z.number().int().min(0).max(1_000_000_000).optional(),
        bonusPiastres: z.number().int().min(0).max(1_000_000_000).optional(),
        deductionPiastres: z.number().int().min(0).max(1_000_000_000).optional(),
        advanceRecoveryPiastres: z.number().int().min(0).max(1_000_000_000).optional(),
        note: z.string().trim().max(200).optional(),
      }),
    )
    .min(1)
    .max(500),
});
