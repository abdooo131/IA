import { z } from 'zod';
import { addDays } from './hours';

// Report periods and comparisons (Accounting UX phase B). A report runs over Cairo calendar
// days [from, to] (both included). Presets are worked out from today; a comparison runs the
// same report over another period and shows the change and the change in percent.

export const PERIOD_PRESETS = [
  'this_month',
  'last_month',
  'this_quarter',
  'this_year',
  'last_year',
  'custom',
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const COMPARE_MODES = ['none', 'previous', 'last_year'] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

export interface DayRange {
  from: string;
  to: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Days in a month (month 1 to 12). */
function daysIn(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parts(day: string) {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return { y, m, d };
}

function make(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** The last day of the month a day is in. */
export function monthEnd(day: string) {
  const { y, m } = parts(day);
  return make(y, m, daysIn(y, m));
}

/** A day moved by whole months; the day of the month is kept, or the month's last day. */
export function shiftDayByMonths(day: string, months: number) {
  const { y, m, d } = parts(day);
  const i = y * 12 + (m - 1) + months;
  const ny = Math.floor(i / 12);
  const nm = (i % 12) + 1;
  return make(ny, nm, Math.min(d, daysIn(ny, nm)));
}

/** The period a preset names on a Cairo day; current periods end today. */
export function presetRange(preset: Exclude<PeriodPreset, 'custom'>, today: string): DayRange {
  const { y, m } = parts(today);
  switch (preset) {
    case 'this_month':
      return { from: make(y, m, 1), to: today };
    case 'last_month': {
      const first = shiftDayByMonths(make(y, m, 1), -1);
      return { from: first, to: monthEnd(first) };
    }
    case 'this_quarter': {
      const qm = Math.floor((m - 1) / 3) * 3 + 1;
      return { from: make(y, qm, 1), to: today };
    }
    case 'this_year':
      return { from: make(y, 1, 1), to: today };
    case 'last_year':
      return { from: make(y - 1, 1, 1), to: make(y - 1, 12, 31) };
  }
}

/** Number of days in a range, both ends included. */
export function rangeDays(r: DayRange) {
  return Math.round((Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) / 86_400_000) + 1;
}

/**
 * The period a comparison runs over. "previous" is the period just before: when the range
 * starts on the first of a month it moves back by the months it covers (a month to date
 * compares with the same days of the month before, a quarter with the quarter before),
 * otherwise by its own length in days. "last_year" is the same days a year earlier.
 */
export function comparisonRange(r: DayRange, mode: CompareMode): DayRange | null {
  if (mode === 'none') return null;
  if (mode === 'last_year')
    return { from: shiftDayByMonths(r.from, -12), to: shiftDayByMonths(r.to, -12) };
  const a = parts(r.from);
  if (a.d === 1) {
    const b = parts(r.to);
    const months = (b.y - a.y) * 12 + (b.m - a.m) + 1;
    const to = r.to === monthEnd(r.to)
      ? monthEnd(shiftDayByMonths(r.to, -months))
      : shiftDayByMonths(r.to, -months);
    return { from: shiftDayByMonths(r.from, -months), to };
  }
  const n = rangeDays(r);
  return { from: addDays(r.from, -n), to: addDays(r.from, -1) };
}

/**
 * Which preset a range is on a day, or custom. The address keeps from and to, so a shared
 * link opens the same days even when the preset would have moved.
 */
export function presetOf(r: DayRange, today: string): PeriodPreset {
  for (const p of PERIOD_PRESETS) {
    if (p === 'custom') continue;
    const x = presetRange(p, today);
    if (x.from === r.from && x.to === r.to) return p;
  }
  return 'custom';
}

export interface Change {
  /** current − previous, in the same unit (piastres) */
  change: number;
  /** The change as a percent of the previous amount (one decimal), null when it was 0 */
  percent: number | null;
}

/** The change between a figure and its comparison. */
export function changeOf(current: number, previous: number): Change {
  const change = current - previous;
  if (previous === 0) return { change, percent: null };
  return { change, percent: Math.round((change / Math.abs(previous)) * 1000) / 10 };
}

/** The filters every drill down report takes from the address. */
export const reportFilterSchema = z.object({
  from: z.string().regex(DAY).optional(),
  to: z.string().regex(DAY).optional(),
  compare: z.enum(COMPARE_MODES).optional(),
  store: z.string().min(1).max(40).optional(),
  merchant: z.string().min(1).max(40).optional(),
});
export type ReportFilter = z.infer<typeof reportFilterSchema>;

export const DRILL_REPORTS = ['profit_and_loss', 'balance_sheet', 'trial_balance'] as const;
export type DrillReport = (typeof DRILL_REPORTS)[number];

/** One account line of a drill down report, with the comparison when asked. */
export interface DrillLine {
  /** The account, or null for a group of wallets (shown as one line) */
  accountId: string | null;
  /** Wallet group code when the line is many wallets */
  walletGroup: number | null;
  wallets: number | null;
  code: string;
  nameEn: string;
  nameAr: string;
  amountPiastres: number;
  /** Trial balance only */
  debitPiastres?: number;
  creditPiastres?: number;
  compareAmountPiastres: number | null;
}

export interface DrillSection {
  key: string;
  lines: DrillLine[];
  totalPiastres: number;
  compareTotalPiastres: number | null;
}

export interface DrillReportResult {
  report: DrillReport;
  from: string;
  to: string;
  compare: { mode: CompareMode; from: string; to: string } | null;
  filters: { store: string | null; merchant: string | null };
  sections: DrillSection[];
  /** The bottom line: profit, or assets − liabilities − equity (0 when balanced) */
  result: { key: string; amountPiastres: number; compareAmountPiastres: number | null };
  /** Trial balance: debits and credits of the period */
  totals?: { debitPiastres: number; creditPiastres: number };
}

/** The ledger lines a drill down opens: an account, a wallet group, or a report's slice. */
export const ledgerLinesQuerySchema = z.object({
  account: z.string().min(1).max(40).optional(),
  group: z.coerce.number().int().min(1000).max(9999).optional(),
  /** income_costs: every income and cost account; money: banks, cash boxes, rider cash */
  set: z.enum(['income_costs', 'money']).optional(),
  kind: z.string().min(1).max(40).optional(),
  from: z.string().regex(DAY).optional(),
  to: z.string().regex(DAY).optional(),
  /** A store id, or "none" for lines with no store */
  store: z.string().min(1).max(40).optional(),
  merchant: z.string().min(1).max(40).optional(),
  rider: z.string().min(1).max(40).optional(),
});
export type LedgerLinesQuery = z.infer<typeof ledgerLinesQuerySchema>;

export const LEDGER_LINE_FILTERS = {
  debit: 'side',
  credit: 'side',
  deliveries: 'kind',
  cash: 'kind',
  payouts: 'kind',
  bills: 'kind',
  manual: 'kind',
  with_order: 'source',
  no_store: 'tag',
} as const;
export const LEDGER_LINE_GROUPS = ['month', 'day', 'store', 'merchant', 'rider', 'kind', 'account'] as const;
export const LEDGER_LINE_SORTS = ['day', 'number', 'amount'] as const;
export const LEDGER_LINE_SUMS = ['debit', 'credit', 'net'] as const;
