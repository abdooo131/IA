import { z } from 'zod';

// The bank matching screen (Accounting UX phase B): for one bank statement line, the ledger
// lines of the same bank account no bank line proves yet, ranked with a plain reason. Exact
// amounts come first (same day, then within three days, then further), then sets of lines that
// add up exactly to the bank line (a deposit of several handovers), then near amounts, then
// lines that could be part of it. Only exact amounts and exact sums can be matched; nothing is
// ever created from a statement line by matching.

export const MATCH_REASONS = [
  'same_day',
  'within_3_days',
  'same_amount',
  'sum',
  'near_amount',
  'partial',
] as const;
export type MatchReason = (typeof MATCH_REASONS)[number];

/** Days a bank line may sit from its ledger line and still count as close. */
export const MATCH_CLOSE_DAYS = 3;
/** Near and partial candidates are looked for this many days around the bank line. */
export const MATCH_WINDOW_DAYS = 7;
/** At most this many ledger lines make one sum suggestion. */
export const MATCH_SUM_MAX_LINES = 3;
/** How many suggestions are shown for one bank line. */
export const MATCH_MAX_SUGGESTIONS = 12;

export interface OpenLedgerLine {
  id: string;
  /** Cairo day the line happened */
  day: string;
  amountPiastres: number;
}

export interface MatchSuggestion {
  /** The ledger lines (one, or several that add up exactly) */
  ids: string[];
  reason: MatchReason;
  /** Sum of the suggested lines */
  amountPiastres: number;
  /** Days between the bank line and the furthest suggested line */
  gapDays: number;
  /** Whether one click matches it (exact amount or exact sum) */
  matchable: boolean;
}

const dayGap = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

const RANK: Record<MatchReason, number> = {
  same_day: 0,
  within_3_days: 1,
  sum: 2,
  same_amount: 3,
  near_amount: 4,
  partial: 5,
};

/** Within 5% (and at least 1 EGP) of the bank amount counts as a near amount. */
function isNear(bank: number, amount: number) {
  if (Math.sign(bank) !== Math.sign(amount) || bank === amount) return false;
  return Math.abs(bank - amount) <= Math.max(100, Math.round(Math.abs(bank) * 0.05));
}

/**
 * Suggestions for one bank line, best first. `open` are the ledger lines of the same bank
 * account that no bank line proves yet.
 */
export function rankSuggestions(
  bank: { day: string; amountPiastres: number },
  open: OpenLedgerLine[],
  max = MATCH_MAX_SUGGESTIONS,
): MatchSuggestion[] {
  const out: MatchSuggestion[] = [];
  const gap = (l: OpenLedgerLine) => dayGap(l.day, bank.day);
  for (const l of open) {
    if (l.amountPiastres !== bank.amountPiastres) continue;
    const g = gap(l);
    out.push({
      ids: [l.id],
      reason: g === 0 ? 'same_day' : g <= MATCH_CLOSE_DAYS ? 'within_3_days' : 'same_amount',
      amountPiastres: l.amountPiastres,
      gapDays: g,
      matchable: true,
    });
  }
  // Parts: same direction, smaller than the bank line, close in time.
  const parts = open
    .filter(
      (l) =>
        Math.sign(l.amountPiastres) === Math.sign(bank.amountPiastres) &&
        Math.abs(l.amountPiastres) < Math.abs(bank.amountPiastres) &&
        gap(l) <= MATCH_WINDOW_DAYS,
    )
    .sort((a, b) => gap(a) - gap(b) || a.id.localeCompare(b.id))
    .slice(0, 40);
  // Sums of two or three parts that add up exactly.
  const sums: MatchSuggestion[] = [];
  const seen = new Set<string>();
  const push = (ls: OpenLedgerLine[]) => {
    const key = ls
      .map((l) => l.id)
      .sort()
      .join(',');
    if (seen.has(key)) return;
    seen.add(key);
    sums.push({
      ids: ls.map((l) => l.id),
      reason: 'sum',
      amountPiastres: bank.amountPiastres,
      gapDays: Math.max(...ls.map(gap)),
      matchable: true,
    });
  };
  for (let i = 0; i < parts.length && sums.length < 6; i++)
    for (let j = i + 1; j < parts.length && sums.length < 6; j++) {
      const a = parts[i]!;
      const b = parts[j]!;
      const two = a.amountPiastres + b.amountPiastres;
      if (two === bank.amountPiastres) push([a, b]);
      else if (MATCH_SUM_MAX_LINES >= 3 && Math.abs(two) < Math.abs(bank.amountPiastres))
        for (let k = j + 1; k < parts.length && sums.length < 6; k++)
          if (two + parts[k]!.amountPiastres === bank.amountPiastres)
            push([a, b, parts[k]!]);
    }
  out.push(...sums);
  for (const l of open) {
    if (!isNear(bank.amountPiastres, l.amountPiastres) || gap(l) > MATCH_WINDOW_DAYS) continue;
    out.push({
      ids: [l.id],
      reason: 'near_amount',
      amountPiastres: l.amountPiastres,
      gapDays: gap(l),
      matchable: false,
    });
  }
  const inSum = new Set(sums.flatMap((s) => s.ids));
  for (const l of parts) {
    if (inSum.has(l.id) || isNear(bank.amountPiastres, l.amountPiastres)) continue;
    out.push({
      ids: [l.id],
      reason: 'partial',
      amountPiastres: l.amountPiastres,
      gapDays: gap(l),
      matchable: false,
    });
  }
  return out
    .sort(
      (a, b) =>
        RANK[a.reason] - RANK[b.reason] ||
        Math.abs(bank.amountPiastres - a.amountPiastres) -
          Math.abs(bank.amountPiastres - b.amountPiastres) ||
        a.gapDays - b.gapDays ||
        a.ids.join(',').localeCompare(b.ids.join(',')),
    )
    .slice(0, max);
}

/** Whether chosen ledger lines prove a bank line: they add up to exactly its amount. */
export function sumMatches(bankAmount: number, amounts: number[]) {
  return amounts.length > 0 && amounts.reduce((s, a) => s + a, 0) === bankAmount;
}

export const bankMatchManySchema = z.object({
  ledgerLineIds: z.array(z.string().min(1).max(40)).min(1).max(20),
});
