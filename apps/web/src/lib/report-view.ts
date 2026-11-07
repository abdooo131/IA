import {
  changeOf,
  COMPARE_MODES,
  type CompareMode,
  type DrillLine,
  type DrillReport,
  type DrillReportResult,
  type ExportCell,
  isCalendarDay,
  type PeriodPreset,
  PERIOD_PRESETS,
  presetOf,
  presetRange,
} from '@shiplynow/shared';

// The drill down reports' address and sums (Accounting UX phase B): the filters live in the
// address (from, to, compare, store, merchant) so Back and shared links open the same report,
// and every line links to its ledger lines with the same filters and a way back.

export interface ReportState {
  from: string;
  to: string;
  compare: CompareMode;
  store: string | null;
  merchant: string | null;
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The report's filters from the address; this month to today when none are given. */
export function readReportState(params: Params, today: string): ReportState {
  const preset = one(params.preset);
  const fromParam = one(params.from);
  const toParam = one(params.to);
  let range =
    preset && preset !== 'custom' && (PERIOD_PRESETS as readonly string[]).includes(preset)
      ? presetRange(preset as Exclude<PeriodPreset, 'custom'>, today)
      : presetRange('this_month', today);
  if (fromParam && toParam && isCalendarDay(fromParam) && isCalendarDay(toParam))
    range = fromParam <= toParam ? { from: fromParam, to: toParam } : { from: toParam, to: fromParam };
  if (range.to > today) range = { ...range, to: today };
  if (range.from > range.to) range = { ...range, from: range.to };
  const compare = one(params.compare);
  const id = (v: string | undefined) => (v && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : null);
  return {
    ...range,
    compare: (COMPARE_MODES as readonly string[]).includes(compare ?? '')
      ? (compare as CompareMode)
      : 'none',
    store: id(one(params.store)),
    merchant: id(one(params.merchant)),
  };
}

/** The query string of a report state (what the API and the address both take). */
export function reportQuery(s: ReportState, extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ from: s.from, to: s.to });
  if (s.compare !== 'none') q.set('compare', s.compare);
  if (s.store) q.set('store', s.store);
  if (s.merchant) q.set('merchant', s.merchant);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return q.toString();
}

export const REPORT_PAGES: Record<DrillReport, string> = {
  profit_and_loss: '/finance/profit-and-loss',
  balance_sheet: '/finance/balance-sheet',
  trial_balance: '/finance/trial',
};

/** Where a report line opens: its ledger lines, with the report's filters and the way back. */
export function linesHref(report: DrillReport, s: ReportState, line: DrillLine) {
  const q = new URLSearchParams();
  if (line.code === 'earnings') q.set('set', 'income_costs');
  else if (line.accountId) q.set('account', line.accountId);
  else if (line.walletGroup) q.set('group', String(line.walletGroup));
  // The balance sheet is "as of" its day: every line up to it.
  if (report !== 'balance_sheet') q.set('from', s.from);
  q.set('to', s.to);
  if (report === 'profit_and_loss') q.set('report', report);
  if (s.store) q.set('store', s.store);
  if (s.merchant) q.set('merchant', s.merchant);
  q.set('back', `${REPORT_PAGES[report]}?${reportQuery(s)}`);
  return `/finance/reports/lines?${q}`;
}

/** The preset a state is on (for the period box). */
export function presetFor(s: ReportState, today: string): PeriodPreset {
  return presetOf({ from: s.from, to: s.to }, today);
}

/** Change and percent text of a line against its comparison. */
export function changeText(current: number, previous: number | null) {
  if (previous === null) return null;
  return changeOf(current, previous);
}

/**
 * A report as export rows: one per account line plus each section's total and the bottom
 * line, money as EGP numbers. Labels come from the caller (the reader's language).
 */
export function reportRows(
  r: DrillReportResult,
  labels: {
    account: (line: DrillLine) => string;
    section: (key: string) => string;
    total: (key: string) => string;
    result: string;
    header: { account: string; debit: string; credit: string; amount: string; compare: string; change: string; percent: string };
  },
): { header: string[]; rows: ExportCell[][] } {
  const trial = r.report === 'trial_balance';
  const egp = (p: number | null | undefined) => (p === null || p === undefined ? null : p / 100);
  const header = [
    labels.header.account,
    ...(trial ? [labels.header.debit, labels.header.credit] : []),
    labels.header.amount,
    ...(r.compare ? [labels.header.compare, labels.header.change, labels.header.percent] : []),
  ];
  const row = (
    label: string,
    amount: number,
    compare: number | null,
    debit?: number,
    credit?: number,
  ): ExportCell[] => {
    const c = r.compare ? changeOf(amount, compare ?? 0) : null;
    return [
      label,
      ...(trial ? [egp(debit), egp(credit)] : []),
      egp(amount),
      ...(c ? [egp(compare ?? 0), egp(c.change), c.percent] : []),
    ];
  };
  const rows: ExportCell[][] = [];
  for (const s of r.sections) {
    rows.push([labels.section(s.key)]);
    for (const l of s.lines)
      rows.push(row(labels.account(l), l.amountPiastres, l.compareAmountPiastres, l.debitPiastres, l.creditPiastres));
    rows.push(row(labels.total(s.key), s.totalPiastres, s.compareTotalPiastres));
  }
  rows.push(
    row(
      labels.result,
      r.result.amountPiastres,
      r.result.compareAmountPiastres,
      r.totals?.debitPiastres,
      r.totals?.creditPiastres,
    ),
  );
  return { header, rows };
}
