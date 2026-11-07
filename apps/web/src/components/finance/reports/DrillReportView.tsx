'use client';

import {
  type DrillLine,
  type DrillReportResult,
  type DrillSection,
  exportCsv,
  exportXlsx,
} from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { download } from '@/components/odoo/ListView';
import { isoToDayFirst } from '@/lib/day-first';
import { formatEgp } from '@/lib/format';
import { changeText, linesHref, reportQuery, reportRows, type ReportState } from '@/lib/report-view';
import { Amount } from '../Amount';

// A drill down report (Accounting UX phase B): sections by category that fold, a line per
// account (or group of wallets) with its comparison, change and percent, each line opening its
// ledger lines, subtotals, the bottom line, and exports (PDF in English or Arabic, CSV, Excel).

function Percent({ value }: { value: number | null }) {
  if (value === null) return <span className="text-text-muted">–</span>;
  return (
    <span className={`ltr-iso ${value < 0 ? 'text-danger' : value > 0 ? 'text-status-delivered' : ''}`}>
      {value > 0 ? '+' : ''}
      {value}%
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className={`shrink-0 transition-transform ${open ? 'rotate-90 rtl:-rotate-90' : 'rtl:rotate-180'}`}
    >
      <path d="M4.5 3 7.5 6 4.5 9" />
    </svg>
  );
}

function ExportMenu({
  report,
  state,
  table,
  name,
}: {
  report: DrillReportResult;
  state: ReportState;
  table: () => ReturnType<typeof reportRows>;
  name: string;
}) {
  const t = useTranslations('finance.drill');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  const pdf = (lang: 'en' | 'ar') =>
    `/api/finance/reports/${report.report}/export.pdf?${reportQuery(state, { lang })}`;
  const file = `${name}-${report.to}`;
  const item =
    'flex min-h-10 w-full items-center rounded-md px-2 text-start text-body-sm hover:bg-surface-raised';
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-10 items-center rounded-md border border-line bg-surface px-3 text-body-sm font-semibold hover:bg-surface-raised"
      >
        {t('export')}
      </button>
      {open && (
        <ul className="absolute end-0 z-40 mt-1 w-56 rounded-lg border border-line bg-surface p-2 shadow-lg">
          <li>
            <a href={pdf('en')} className={item}>
              {t('pdfEn')}
            </a>
          </li>
          <li>
            <a href={pdf('ar')} className={item}>
              {t('pdfAr')}
            </a>
          </li>
          <li>
            <button
              type="button"
              className={item}
              onClick={() => {
                const x = table();
                download(
                  `${file}.csv`,
                  new Blob([exportCsv(x.header, x.rows)], { type: 'text/csv;charset=utf-8' }),
                );
                setOpen(false);
              }}
            >
              {t('csv')}
            </button>
          </li>
          <li>
            <button
              type="button"
              className={item}
              onClick={() => {
                const x = table();
                download(
                  `${file}.xlsx`,
                  new Blob(
                    [exportXlsx(x.header, x.rows, { sheetName: name, rtl: locale === 'ar' }) as BlobPart],
                    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
                  ),
                );
                setOpen(false);
              }}
            >
              {t('xlsx')}
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

export function DrillReportView({
  report,
  state,
  exportName,
}: {
  report: DrillReportResult;
  state: ReportState;
  exportName: string;
}) {
  const t = useTranslations('finance.drill');
  const tr = useTranslations('finance.reports');
  const locale = useLocale();
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const trial = report.report === 'trial_balance';
  const cmp = report.compare;

  const accountLabel = (l: DrillLine) => {
    if (l.code === 'earnings') return tr('earnings');
    if (l.walletGroup !== null)
      return tr('wallets', {
        count: l.wallets ?? 0,
        group: tr.has(`groups.g${l.walletGroup}`) ? tr(`groups.g${l.walletGroup}`) : String(l.walletGroup),
      });
    return locale === 'ar' ? l.nameAr || l.nameEn : l.nameEn;
  };
  const sectionLabel = (k: string) => t(`sections.${k}`);
  const totalLabel = (k: string) => t('totalOf', { section: sectionLabel(k) });
  const resultLabel =
    report.result.key === 'profit'
      ? report.result.amountPiastres >= 0
        ? tr('profit')
        : tr('loss')
      : t('difference');
  const table = () =>
    reportRows(report, {
      account: (l) => (l.code && l.code !== 'earnings' && l.walletGroup === null ? `${l.code} ` : '') + accountLabel(l),
      section: sectionLabel,
      total: totalLabel,
      result: resultLabel,
      header: {
        account: t('account'),
        debit: t('debit'),
        credit: t('credit'),
        amount: trial ? t('balance') : t('amount'),
        compare: t('compared'),
        change: t('change'),
        percent: '%',
      },
    });

  const toggle = (k: string) =>
    setClosed((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const th = 'px-3 py-2 text-end text-label uppercase text-text-muted';
  const figures = (
    amount: number,
    compare: number | null,
    debit?: number,
    credit?: number,
    strong = false,
  ) => {
    const c = cmp ? changeText(amount, compare ?? 0) : null;
    return (
      <>
        {trial && (
          <>
            <td className="px-3 py-2 text-end">
              {debit !== undefined && <span className="ltr-iso">{formatEgp(debit)}</span>}
            </td>
            <td className="px-3 py-2 text-end">
              {credit !== undefined && <span className="ltr-iso">{formatEgp(credit)}</span>}
            </td>
          </>
        )}
        <td className="px-3 py-2 text-end">
          <Amount piastres={amount} strong={strong} />
        </td>
        {c && (
          <>
            <td className="px-3 py-2 text-end text-text-muted">
              <Amount piastres={compare ?? 0} />
            </td>
            <td className="px-3 py-2 text-end">
              <Amount piastres={c.change} />
            </td>
            <td className="px-3 py-2 text-end">
              <Percent value={c.percent} />
            </td>
          </>
        )}
      </>
    );
  };

  const lineRow = (l: DrillLine) => {
    const href = linesHref(report.report, state, l);
    return (
      <tr key={`${l.accountId ?? l.walletGroup ?? l.code}`} className="border-t border-line hover:bg-surface-raised">
        <td className="px-3 py-2">
          <Link href={href} className="text-link hover:underline">
            {l.code && l.code !== 'earnings' && l.walletGroup === null && (
              <span className="ltr-iso me-2 font-bold">{l.code}</span>
            )}
            {accountLabel(l)}
          </Link>
        </td>
        {figures(l.amountPiastres, l.compareAmountPiastres, l.debitPiastres, l.creditPiastres)}
      </tr>
    );
  };

  const cols = 2 + (trial ? 2 : 0) + (cmp ? 3 : 0);

  const sectionBlock = (s: DrillSection) => {
    const open = !closed.has(s.key);
    return (
      <tbody key={s.key}>
        <tr className="border-t-2 border-line bg-surface-raised">
          <th colSpan={cols} scope="colgroup" className="p-0 text-start">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => toggle(s.key)}
              className="flex min-h-11 w-full items-center gap-2 px-3 text-start text-body font-bold"
            >
              <Chevron open={open} />
              {sectionLabel(s.key)}
              <span className="ms-auto font-semibold">
                <Amount piastres={s.totalPiastres} />
              </span>
            </button>
          </th>
        </tr>
        {open && s.lines.length === 0 && (
          <tr>
            <td colSpan={cols} className="px-3 py-2 text-body-sm text-text-muted">
              {tr('nothing')}
            </td>
          </tr>
        )}
        {open && s.lines.map(lineRow)}
        {open && (
          <tr className="border-t border-line font-bold">
            <td className="px-3 py-2">{totalLabel(s.key)}</td>
            {figures(s.totalPiastres, s.compareTotalPiastres, undefined, undefined, true)}
          </tr>
        )}
      </tbody>
    );
  };

  // Phones: one card per section, each line with its figures under its name.
  const cardLine = (l: DrillLine) => {
    const c = cmp ? changeText(l.amountPiastres, l.compareAmountPiastres ?? 0) : null;
    return (
      <li key={`${l.accountId ?? l.walletGroup ?? l.code}`}>
        <Link
          href={linesHref(report.report, state, l)}
          className="flex min-h-12 items-start justify-between gap-3 px-3 py-2 hover:bg-surface-raised"
        >
          <span className="min-w-0 text-body-sm text-link">
            {l.code && l.code !== 'earnings' && l.walletGroup === null && (
              <span className="ltr-iso me-1 font-bold">{l.code}</span>
            )}
            {accountLabel(l)}
          </span>
          <span className="shrink-0 text-end text-body-sm">
            <Amount piastres={l.amountPiastres} strong />
            {c && (
              <span className="block text-caption text-text-muted">
                <Amount piastres={l.compareAmountPiastres ?? 0} /> · <Percent value={c.percent} />
              </span>
            )}
          </span>
        </Link>
      </li>
    );
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body-sm text-text-muted">
          {report.report === 'balance_sheet'
            ? t('asOfDay', { day: isoToDayFirst(report.to) })
            : t('periodDays', { from: isoToDayFirst(report.from), to: isoToDayFirst(report.to) })}
          {cmp && (
            <span className="block">
              {report.report === 'balance_sheet'
                ? t('comparedAsOf', { day: isoToDayFirst(cmp.to) })
                : t('comparedWith', { from: isoToDayFirst(cmp.from), to: isoToDayFirst(cmp.to) })}
            </span>
          )}
        </p>
        <ExportMenu report={report} state={state} table={table} name={exportName} />
      </div>

      <div className="mt-3 hidden overflow-x-auto rounded-lg border border-line bg-surface md:block">
        <table className="w-full text-body-sm">
          <thead className="bg-surface">
            <tr>
              <th className="px-3 py-2 text-start text-label uppercase text-text-muted">
                {t('account')}
              </th>
              {trial && (
                <>
                  <th className={th}>{t('debit')}</th>
                  <th className={th}>{t('credit')}</th>
                </>
              )}
              <th className={th}>{trial ? t('balance') : t('amount')}</th>
              {cmp && (
                <>
                  <th className={th}>{t('compared')}</th>
                  <th className={th}>{t('change')}</th>
                  <th className={th}>%</th>
                </>
              )}
            </tr>
          </thead>
          {report.sections.map(sectionBlock)}
          <tbody>
            <tr className="border-t-2 border-line-strong bg-selected-bg text-body font-bold">
              <td className="px-3 py-3">{resultLabel}</td>
              {figures(
                report.result.amountPiastres,
                report.result.compareAmountPiastres,
                report.totals?.debitPiastres,
                report.totals?.creditPiastres,
                true,
              )}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-3 space-y-3 md:hidden">
        {report.sections.map((s) => {
          const open = !closed.has(s.key);
          return (
            <section key={s.key} className="overflow-hidden rounded-lg border border-line bg-surface">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => toggle(s.key)}
                className="flex min-h-12 w-full items-center gap-2 bg-surface-raised px-3 text-start font-bold"
              >
                <Chevron open={open} />
                {sectionLabel(s.key)}
                <span className="ms-auto">
                  <Amount piastres={s.totalPiastres} />
                </span>
              </button>
              {open && (
                <ul className="divide-y divide-line">
                  {s.lines.length === 0 && (
                    <li className="px-3 py-2 text-body-sm text-text-muted">{tr('nothing')}</li>
                  )}
                  {s.lines.map(cardLine)}
                </ul>
              )}
            </section>
          );
        })}
        <p className="flex items-center justify-between gap-3 rounded-lg border border-line bg-selected-bg px-3 py-3 font-bold">
          <span>{resultLabel}</span>
          <span className="text-end">
            <Amount piastres={report.result.amountPiastres} strong />
            {cmp && (
              <span className="block text-caption font-normal text-text-muted">
                <Amount piastres={report.result.compareAmountPiastres ?? 0} /> ·{' '}
                <Percent
                  value={
                    changeText(report.result.amountPiastres, report.result.compareAmountPiastres ?? 0)
                      ?.percent ?? null
                  }
                />
              </span>
            )}
          </span>
        </p>
      </div>
      <p className="mt-2 text-caption text-text-muted">{t('clickHint')}</p>
    </div>
  );
}
