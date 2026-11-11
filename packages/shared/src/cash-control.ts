import { z } from 'zod';
import { attachmentIdsField } from './attachments';
import type { PayoutScheduleName } from './finance';

// Cash controls: what riders may carry, petty cash at the stores, the daily cash position and
// the month end checklist. Shared by the API, the database layer and the screens.

const id = z.string().min(1).max(64);
const key = z.string().min(8).max(100);

// ─── rider cash ─────────────────────────────────────────────────────────────────

/** One amount of cash a rider collected and still holds, with when it was collected. */
export interface CashPiece {
  amountPiastres: number;
  at: Date;
}

/**
 * The cash a rider holds, split by when it was collected. Cash is handed in oldest first, so
 * what is still held is the most recent collections covering the balance (the oldest of them
 * only partly). `collections` are the amounts collected, newest first.
 */
export function heldPieces(balancePiastres: number, collections: CashPiece[]): CashPiece[] {
  const pieces: CashPiece[] = [];
  let left = balancePiastres;
  for (const c of collections) {
    if (left <= 0) break;
    if (c.amountPiastres <= 0) continue;
    const take = Math.min(left, c.amountPiastres);
    pieces.push({ amountPiastres: take, at: c.at });
    left -= take;
  }
  // A balance with no collection behind it (an old charge left on the rider): counted as old.
  if (left > 0) pieces.push({ amountPiastres: left, at: new Date(0) });
  return pieces;
}

export const CASH_AGE_BUCKETS = ['fresh', 'aging', 'overdue'] as const;
export type CashAgeBucket = (typeof CASH_AGE_BUCKETS)[number];

/** fresh: under the warning hours; aging: up to the maximum; overdue: past the maximum. */
export function cashAgeBucket(ageMs: number, warnHours: number, maxHours: number): CashAgeBucket {
  if (ageMs > maxHours * 3_600_000) return 'overdue';
  if (ageMs >= warnHours * 3_600_000) return 'aging';
  return 'fresh';
}

/** Totals of each age bucket. */
export function bucketCash(
  pieces: CashPiece[],
  now: Date,
  warnHours: number,
  maxHours: number,
): Record<CashAgeBucket, number> {
  const out: Record<CashAgeBucket, number> = { fresh: 0, aging: 0, overdue: 0 };
  for (const p of pieces)
    out[cashAgeBucket(now.getTime() - p.at.getTime(), warnHours, maxHours)] += p.amountPiastres;
  return out;
}

// ─── payouts ────────────────────────────────────────────────────────────────────

/** The Cairo day (YYYY-MM-DD) on or after `today` when a schedule next pays (Sunday is 0). */
export function nextPayoutDay(schedule: PayoutScheduleName, today: string): string {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  for (let i = 0; i < 7; i++) {
    const date = new Date(Date.UTC(y, m - 1, d + i));
    const weekday = date.getUTCDay();
    const due =
      schedule === 'daily' ||
      (schedule === 'twice_weekly' && (weekday === 0 || weekday === 3)) ||
      (schedule === 'weekly' && weekday === 0);
    if (due) return date.toISOString().slice(0, 10);
  }
  return today;
}

// ─── petty cash ─────────────────────────────────────────────────────────────────

export const pettyCashLabel = (n: number) => `PC-${String(n).padStart(6, '0')}`;

export const PETTY_CASH_STATUSES = [
  'posted',
  'pending',
  'rejected',
  'cancelled',
  'reversed',
] as const;
export type PettyCashStatus = (typeof PETTY_CASH_STATUSES)[number];

/** Store staff pay a small expense from the store's cash box, with a receipt photo. */
export const pettyCashSchema = z.object({
  attachmentIds: attachmentIdsField,
  expenseAccountId: id,
  amountPiastres: z.number().int().min(1).max(100_000_000),
  note: z.string().trim().min(3).max(300),
  photoId: id,
  /** The user's own cost tag (a campaign, a project) on the expense line */
  costTagId: id.optional(),
  idempotencyKey: key,
});

export const pettyCashReverseSchema = z.object({
  reason: z.string().trim().min(5).max(300),
});

/** Finance marks which expense categories store staff may choose. */
export const pettyCategorySchema = z.object({ petty: z.boolean() });

// ─── month end ──────────────────────────────────────────────────────────────────

export const MONTH_END_ITEMS = [
  'cash_handovers',
  'bank_lines',
  'receipts',
  'petty_cash',
  'invoices',
  'payroll',
  'storage',
  'depreciation',
  'vat_return',
  'books_closed',
] as const;
export type MonthEndItem = (typeof MONTH_END_ITEMS)[number];

/** Items nothing in the system can check: finance ticks them with a note. */
export const MANUAL_MONTH_END_ITEMS: readonly MonthEndItem[] = ['vat_return'];

/** Any item but the books themselves can be marked done by hand, with a note. */
export const monthEndMarkSchema = z.object({
  item: z.enum(MONTH_END_ITEMS).refine((i) => i !== 'books_closed', 'invalid_item'),
  note: z.string().trim().min(3).max(300),
});

export const isMonth = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

/** YYYY-MM moved by n months (negative goes back). */
export function shiftMonth(month: string, n: number) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}
