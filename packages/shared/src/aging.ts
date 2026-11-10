import { z } from 'zod';
import { isCalendarDay } from './hours';

// Aging reports (who owes us and what we owe suppliers, by how old it is), the reminders sent
// to merchants who owe us, and debit notes (charging a merchant more after an invoice).
//
// Every age is counted in Cairo calendar days between two YYYY-MM-DD days, never in hours,
// so a debt that arose late last night is one day old this morning.

/** The age bands of both reports, youngest first. */
export const AGING_BANDS = ['current', 'd1_30', 'd31_60', 'd61_90', 'over_90'] as const;
export type AgingBand = (typeof AGING_BANDS)[number];
export type AgingBuckets = Record<AgingBand, number>;

export const emptyBuckets = (): AgingBuckets => ({
  current: 0,
  d1_30: 0,
  d31_60: 0,
  d61_90: 0,
  over_90: 0,
});

/** Whole Cairo days from one calendar day to another (negative when `to` is earlier). */
export function daysBetweenDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * The band of an amount `daysLate` days past its due day: on or before the due day it is not
 * yet due (current), then 1 to 30, 31 to 60, 61 to 90 and over 90 days.
 */
export function agingBand(daysLate: number): AgingBand {
  if (daysLate <= 0) return 'current';
  if (daysLate <= 30) return 'd1_30';
  if (daysLate <= 60) return 'd31_60';
  if (daysLate <= 90) return 'd61_90';
  return 'over_90';
}

/** One movement of a merchant wallet: debit positive (they owe us more), credit negative. */
export interface WalletMove {
  amount: number;
  /** The Cairo day it happened (YYYY-MM-DD) */
  day: string;
}

/**
 * What is still unpaid of a wallet's debits, oldest first (first in, first out).
 *
 * A merchant wallet has no due dates: each fee, storage day or charge is owed from the day
 * it was booked. Walking the wallet in order, every credit (cash we collected for them, a
 * payment from them, a credit note) pays the oldest debit still open; a credit with nothing
 * open to pay waits as credit and pays the next debits as they come. What is left at the end
 * are the debits nobody has paid yet, each with the day it arose. Their sum is the balance
 * whenever the wallet is in debit; when it is in credit nothing is left open.
 */
export function openDebits(moves: WalletMove[]): { open: WalletMove[]; credit: number } {
  const open: WalletMove[] = [];
  let credit = 0;
  for (const m of moves) {
    if (m.amount > 0) {
      const used = Math.min(credit, m.amount);
      credit -= used;
      if (m.amount > used) open.push({ amount: m.amount - used, day: m.day });
    } else if (m.amount < 0) {
      let pay = -m.amount;
      while (pay > 0 && open.length > 0) {
        const first = open[0]!;
        const used = Math.min(first.amount, pay);
        first.amount -= used;
        pay -= used;
        if (first.amount === 0) open.shift();
      }
      credit += pay;
    }
  }
  return { open, credit };
}

/** The open debits of a wallet spread over the age bands on a day (age = days since it arose). */
export function bucketsOf(open: WalletMove[], asOf: string): AgingBuckets {
  const b = emptyBuckets();
  for (const o of open) b[agingBand(daysBetweenDays(o.day, asOf))] += o.amount;
  return b;
}

export const sumBuckets = (b: AgingBuckets) => AGING_BANDS.reduce((s, k) => s + b[k], 0);

export function addBuckets(into: AgingBuckets, b: AgingBuckets) {
  for (const k of AGING_BANDS) into[k] += b[k];
}

// ─── reminders ──────────────────────────────────────────────────────────────────

export interface ReminderRules {
  /** First reminder after this many days in debit */
  firstDays: number;
  /** Then one every this many days */
  everyDays: number;
  /** At most this many per debit period (automatic reminders stop there) */
  max: number;
}

/**
 * Whether the daily job sends a reminder today to a merchant in debit since `sinceDay`, who
 * got `sent` reminders in this debit period (the last on `lastDay`). Reminders sent by hand
 * count too: they use up one of the max and restart the wait.
 */
export function reminderDue(
  input: { sinceDay: string; today: string; sent: number; lastDay: string | null },
  rules: ReminderRules,
): boolean {
  if (input.sent >= rules.max) return false;
  if (input.sent === 0 || !input.lastDay)
    return daysBetweenDays(input.sinceDay, input.today) >= rules.firstDays;
  return daysBetweenDays(input.lastDay, input.today) >= Math.max(rules.everyDays, 1);
}

// ─── requests ───────────────────────────────────────────────────────────────────

const day = z.string().refine(isCalendarDay, 'invalid_day');

/** The filters of both aging reports (as of a Cairo day, a store, a party search). */
export const agingQuerySchema = z.object({
  day: day.optional(),
  store: z.string().min(1).max(64).optional(),
  q: z.string().trim().max(100).optional(),
  lang: z.enum(['en', 'ar']).optional(),
});
export type AgingQuery = z.infer<typeof agingQuerySchema>;

export const sendReminderSchema = z.object({
  idempotencyKey: z.string().min(8).max(100),
});

/** The fee kinds a debit note line may charge (the invoice's own kinds, plus an adjustment). */
export const DEBIT_NOTE_KINDS = [
  'shipping_fee',
  'product_handling',
  'order_fee',
  'cod_fee',
  'failed_fee',
  'receiving_fee',
  'storage_fee',
  'return_fee',
  'packaging_charge',
  'minimum_fee',
  'adjustment',
] as const;
export type DebitNoteKind = (typeof DEBIT_NOTE_KINDS)[number];

export const debitNoteSchema = z.object({
  lines: z
    .array(
      z.object({
        kind: z.enum(DEBIT_NOTE_KINDS),
        quantity: z.number().int().min(1).max(100_000).default(1),
        /** The fee before VAT, in piastres */
        netPiastres: z.number().int().min(1).max(1_000_000_000),
      }),
    )
    .min(1)
    .max(20),
  reason: z.string().trim().min(5).max(300),
  /** The store the extra fee belongs to, for profit per store (none: company wide) */
  darkStoreId: z.string().min(1).max(64).nullish(),
  idempotencyKey: z.string().min(8).max(100),
});
export type DebitNoteRequest = z.infer<typeof debitNoteSchema>;
