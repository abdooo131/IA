import {
  changeOf,
  comparisonRange,
  type DrillReportResult,
  presetOf,
  presetRange,
  rankSuggestions,
  shiftDayByMonths,
  sumMatches,
} from '@shiplynow/shared';
import { describe, expect, it } from 'vitest';
import { linesHref, readReportState, reportQuery, reportRows } from './report-view';

describe('report periods', () => {
  const today = '2026-11-07';
  it('works out the presets from today', () => {
    expect(presetRange('this_month', today)).toEqual({ from: '2026-11-01', to: today });
    expect(presetRange('last_month', today)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(presetRange('this_quarter', today)).toEqual({ from: '2026-10-01', to: today });
    expect(presetRange('this_year', today)).toEqual({ from: '2026-01-01', to: today });
    expect(presetRange('last_year', today)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(presetRange('last_month', '2026-01-15')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(presetOf({ from: '2026-10-01', to: '2026-10-31' }, today)).toBe('last_month');
    expect(presetOf({ from: '2026-10-03', to: '2026-10-09' }, today)).toBe('custom');
  });

  it('compares with the previous period and the same period last year', () => {
    // A month to date: the same days of the month before.
    expect(comparisonRange({ from: '2026-11-01', to: '2026-11-07' }, 'previous')).toEqual({
      from: '2026-10-01',
      to: '2026-10-07',
    });
    // A whole month: the whole month before, to its own last day.
    expect(comparisonRange({ from: '2026-03-01', to: '2026-03-31' }, 'previous')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    // A quarter: the quarter before.
    expect(comparisonRange({ from: '2026-10-01', to: '2026-12-31' }, 'previous')).toEqual({
      from: '2026-07-01',
      to: '2026-09-30',
    });
    // Free days: the same number of days just before.
    expect(comparisonRange({ from: '2026-10-10', to: '2026-10-16' }, 'previous')).toEqual({
      from: '2026-10-03',
      to: '2026-10-09',
    });
    expect(comparisonRange({ from: '2024-02-01', to: '2024-02-29' }, 'last_year')).toEqual({
      from: '2023-02-01',
      to: '2023-02-28',
    });
    expect(comparisonRange({ from: '2026-11-01', to: today }, 'none')).toBeNull();
    expect(shiftDayByMonths('2026-03-31', -1)).toBe('2026-02-28');
  });

  it('works out the change and the change in percent', () => {
    expect(changeOf(12_500, 10_000)).toEqual({ change: 2_500, percent: 25 });
    expect(changeOf(5_000, 10_000)).toEqual({ change: -5_000, percent: -50 });
    // A loss that shrank is an improvement: percent against the size of what it was.
    expect(changeOf(-1_000, -4_000)).toEqual({ change: 3_000, percent: 75 });
    expect(changeOf(7_000, 0)).toEqual({ change: 7_000, percent: null });
    expect(changeOf(1, 3)).toEqual({ change: -2, percent: -66.7 });
  });

  it('reads the filters from the address and links each line with the way back', () => {
    const s = readReportState({ from: '2026-10-01', to: '2026-10-31', compare: 'previous' }, today);
    expect(s).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      compare: 'previous',
      store: null,
      merchant: null,
    });
    expect(readReportState({}, today)).toMatchObject({ from: '2026-11-01', to: today });
    expect(readReportState({ preset: 'last_year' }, today)).toMatchObject({
      from: '2025-01-01',
      to: '2025-12-31',
    });
    // Never past today, never upside down.
    expect(readReportState({ from: '2026-11-01', to: '2026-12-31' }, today).to).toBe(today);
    expect(reportQuery({ ...s, store: 'st1' })).toBe(
      'from=2026-10-01&to=2026-10-31&compare=previous&store=st1',
    );
    const href = linesHref('profit_and_loss', s, {
      accountId: 'acc1',
      walletGroup: null,
      wallets: null,
      code: '4100',
      nameEn: 'Fees',
      nameAr: 'رسوم',
      amountPiastres: 1,
      compareAmountPiastres: 0,
    });
    const q = new URL(href, 'http://x').searchParams;
    expect(q.get('account')).toBe('acc1');
    expect(q.get('report')).toBe('profit_and_loss');
    expect(q.get('back')).toBe(
      '/finance/profit-and-loss?from=2026-10-01&to=2026-10-31&compare=previous',
    );
    // The balance sheet opens every line up to its day.
    const bs = new URL(
      linesHref('balance_sheet', s, {
        accountId: null,
        walletGroup: 2100,
        wallets: 3,
        code: '2100',
        nameEn: '',
        nameAr: '',
        amountPiastres: 1,
        compareAmountPiastres: null,
      }),
      'http://x',
    ).searchParams;
    expect(bs.get('group')).toBe('2100');
    expect(bs.get('from')).toBeNull();
    // The earnings line names the balance sheet, so its lines start after the last closed year.
    const earnings = new URL(
      linesHref('balance_sheet', s, {
        accountId: null,
        walletGroup: null,
        wallets: null,
        code: 'earnings',
        nameEn: '',
        nameAr: '',
        amountPiastres: 1,
        compareAmountPiastres: null,
      }),
      'http://x',
    ).searchParams;
    expect(earnings.get('set')).toBe('income_costs');
    expect(earnings.get('report')).toBe('balance_sheet');
    expect(earnings.get('from')).toBeNull();
  });

  it('exports a report with its comparison columns', () => {
    const r: DrillReportResult = {
      report: 'profit_and_loss',
      from: '2026-11-01',
      to: today,
      compare: { mode: 'previous', from: '2026-10-01', to: '2026-10-07' },
      filters: { store: null, merchant: null },
      sections: [
        {
          key: 'income',
          lines: [
            {
              accountId: 'a',
              walletGroup: null,
              wallets: null,
              code: '4100',
              nameEn: 'Fees',
              nameAr: 'رسوم',
              amountPiastres: 15_000,
              compareAmountPiastres: 10_000,
            },
          ],
          totalPiastres: 15_000,
          compareTotalPiastres: 10_000,
        },
      ],
      result: { key: 'profit', amountPiastres: 15_000, compareAmountPiastres: 10_000 },
    };
    const table = reportRows(r, {
      account: (l) => `${l.code} ${l.nameEn}`,
      section: (k) => k,
      total: (k) => `Total ${k}`,
      result: 'Profit',
      header: {
        account: 'Account',
        debit: 'Debit',
        credit: 'Credit',
        amount: 'Amount',
        compare: 'Compared',
        change: 'Change',
        percent: '%',
      },
    });
    expect(table.header).toEqual(['Account', 'Amount', 'Compared', 'Change', '%']);
    expect(table.rows[1]).toEqual(['4100 Fees', 150, 100, 50, 50]);
    expect(table.rows.at(-1)).toEqual(['Profit', 150, 100, 50, 50]);
  });
});

describe('bank matching helpers', () => {
  it('only lets lines that add up exactly prove a bank line', () => {
    expect(sumMatches(50_000, [30_000, 20_000])).toBe(true);
    expect(sumMatches(50_000, [30_000])).toBe(false);
    expect(sumMatches(50_000, [])).toBe(false);
    const s = rankSuggestions({ day: '2026-11-01', amountPiastres: -1_500 }, [
      { id: 'x', day: '2026-11-01', amountPiastres: -1_500 },
    ]);
    expect(s[0]).toMatchObject({ reason: 'same_day', matchable: true });
  });
});
