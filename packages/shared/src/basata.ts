import { z } from 'zod';
import { attachmentIdsField } from './attachments';
import { cairoAt, cairoDay, addDays } from './hours';

// Basata cash deposits (owner, 2026-11-11): the company goes cashless. A rider deposits the
// cash they collected at a Basata branch and sends the receipt photo (BD-000001); Accounting
// checks it and approves or rejects it; Basata transfers the approved deposits to our bank once
// a day less its fee (BT-000001). Cash still held at the daily deposit deadline
// (cash.deposit_deadline_hour, Cairo) is taken from the rider and the rider is frozen until
// Accounting unfreezes them.

const id = z.string().min(1).max(64);
const key = z.string().min(8).max(100);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const basataDepositNumber = (n: number) => `BD-${String(n).padStart(6, '0')}`;
export const basataSettlementNumber = (n: number) => `BT-${String(n).padStart(6, '0')}`;

export const BASATA_DEPOSIT_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type BasataDepositStatus = (typeof BASATA_DEPOSIT_STATUSES)[number];

/** Why a rider was frozen: cash held at the deadline, or a deposit refused after it. */
export const FREEZE_REASONS = ['deposit_deadline', 'deposit_rejected'] as const;
export type FreezeReason = (typeof FREEZE_REASONS)[number];

/** A rider sends a Basata deposit from the rider app. */
export const basataDepositSchema = z.object({
  amountPiastres: z.number().int().min(1).max(100_000_000),
  /** Basata's reference number printed on the receipt */
  reference: z.string().trim().min(3).max(60),
  /** When the cash was deposited (ISO date and time; default now, never in the future) */
  depositedAt: z.string().datetime({ offset: true }).optional(),
  /** The receipt photo (kind basata_receipt) the rider uploaded */
  photoId: id,
  idempotencyKey: key,
});
export type BasataDepositBody = z.infer<typeof basataDepositSchema>;

/** Accounting refuses a deposit, or unfreezes a rider: always with a written reason. */
export const basataRejectSchema = z.object({ reason: z.string().trim().min(5).max(300) });
export const unfreezeRiderSchema = z.object({ reason: z.string().trim().min(5).max(300) });

/** Basata's daily transfer reached the bank: what arrived and the deposits it covers. */
export const basataSettlementSchema = z.object({
  attachmentIds: attachmentIdsField,
  /** The bank it reached (default the main bank, CIB) */
  bankAccountId: id.optional(),
  /** The Cairo day the money arrived (never in the future) */
  receivedOn: day,
  amountPiastres: z.number().int().min(1).max(2_000_000_000),
  depositIds: z.array(id).min(1).max(2000),
  reference: z.string().trim().max(100).optional(),
  idempotencyKey: key,
});
export type BasataSettlementBody = z.infer<typeof basataSettlementSchema>;

/** The deposit deadline of a Cairo day: that day at `hour`:00 Cairo time (summer time kept). */
export function depositDeadline(dayText: string, hour: number): Date {
  return cairoAt(dayText, hour * 60);
}

/**
 * The Cairo day whose deadline a moment counts for: the first deadline at or after it (sent
 * at 22:59 counts for today, at 23:00 or later for tomorrow when the hour is 23).
 */
export function deadlineDayOf(at: Date, hour: number): string {
  const today = cairoDay(at);
  return at < depositDeadline(today, hour) ? today : addDays(today, 1);
}

/** The last deadline that has passed at `now` (its Cairo day). */
export function lastDeadlineDay(now: Date, hour: number): string {
  const today = cairoDay(now);
  return now >= depositDeadline(today, hour) ? today : addDays(today, -1);
}
