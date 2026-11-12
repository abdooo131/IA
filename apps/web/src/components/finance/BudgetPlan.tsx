'use client';

import { accountGroup, exportCsv, exportXlsx, QUARTERS } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react';
import { download } from '@/components/odoo/ListView';
import { apiSend } from '@/lib/api-client';
import type { BudgetCell, BudgetTotals, BudgetYearReport, StoreOption } from '@/lib/finance-types';
import { formatEgp } from '@/lib/format';
import { parseEgp } from '@/lib/money';
import { Amount } from './Amount';
import { ActionMessage, useFinanceAction } from './useFinanceAction';

// Budgets planned per quarter, then by month: for a year, a scope (whole company read only,
// company wide or one store) and an account group, each income and cost account shows Q1 to
// Q4 and the year with budget, actual and variance; a quarter opens into its months. Typing a
// quarter splits it equally (the last month takes the leftover piastres); typing a month marks
// it as changed by hand and the quarter becomes the sum of its months. Exports CSV and Excel,
// and copies last year's budget to this year (optionally raised by a percent).

const field = 'h-10 w-full rounded-md border border-line bg-surface px-2 text-body-sm';
const button =
  'inline-flex h-10 items-center rounded-md border border-line bg-surface px-3 text-body-sm font-semibold hover:bg-surface-raised disabled:opacity-50';
const th = 'px-2 py-2 text-start text-label uppercase text-text-muted whitespace-nowrap';
const td = 'px-2 py-2 align-top';
const egp = (p: number) => Number((p / 100).toFixed(2));
const percentText = (bp: number | null) =>
  bp === null ? '' : `${bp > 0 ? '+' : ''}${(bp / 100).toFixed(1)}%`;
const monthIndex = (month: string) => Number(month.slice(5, 7)) - 1;

type Row = BudgetYearReport['rows'][number];

/** A budget typed in EGP, saved when the field is left or Enter is pressed. */
function BudgetInput({
  value,
  label,
  disabled,
  onSave,
}: {
  value: number;
  label: string;
  disabled: boolean;
  onSave: (piastres: number) => void;
}) {
  const [text, setText] = useState(value ? (value / 100).toFixed(2) : '');
  const parsed = text.trim() === '' ? 0 : parseEgp(text);
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (parsed !== null && parsed !== value) onSave(parsed);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      inputMode="decimal"
      dir="ltr"
      aria-label={label}
      aria-invalid={parsed === null}
      placeholder="0.00"
      disabled={disabled}
      className={`${field} h-9 w-28 text-end ${parsed === null ? 'border-danger' : ''}`}
    />
  );
}

/** Budget (typed or shown), then actual and the variance with its percent. */
function CellView({
  cell,
  input,
  marker,
}: {
  cell: BudgetCell;
  input?: ReactNode;
  marker?: ReactNode;
}) {
  const t = useTranslations('finance.budgetPlan');
  const tone =
    cell.budgetPiastres && cell.variancePiastres < 0
      ? 'text-danger'
      : cell.budgetPiastres && cell.variancePiastres > 0
        ? 'text-status-delivered'
        : 'text-text-muted';
  return (
    <div className="flex min-w-32 flex-col items-end gap-0.5 text-end">
      <div className="flex items-center gap-1">
        {marker}
        {input ?? <Amount piastres={cell.budgetPiastres} strong />}
      </div>
      <span className="text-caption text-text-muted">
        {t('actualShort')} <Amount piastres={cell.actualPiastres} />
      </span>
      <span className={`text-caption ${tone}`}>
        {cell.budgetPiastres ? (
          <>
            <span className="ltr-iso">{formatEgp(cell.variancePiastres)}</span>{' '}
            <span className="ltr-iso">{percentText(cell.percentBp)}</span>
          </>
        ) : (
          '-'
        )}
      </span>
    </div>
  );
}

function ByHand({ label }: { label: string }) {
  return (
    <span
      title={label}
      aria-label={label}
      className="inline-block size-2 shrink-0 rounded-full bg-status-needs-action"
    />
  );
}

export function BudgetPlan({
  report,
  stores,
  canEdit,
  canSeeAll,
}: {
  report: BudgetYearReport;
  stores: StoreOption[];
  /** Accounting use */
  canEdit: boolean;
  /** Every store: may read the whole company and company wide budgets */
  canSeeAll: boolean;
}) {
  const t = useTranslations('finance.budgetPlan');
  const tg = useTranslations('finance.accounts.groups');
  const locale = useLocale();
  const router = useRouter();
  const action = useFinanceAction();
  const [open, setOpen] = useState<number[]>([]);
  const [hideEmpty, setHideEmpty] = useState(false);
  const scope = report.scope;
  const editable = canEdit && scope !== 'all';
  const storeId = scope === 'all' || scope === 'company' ? undefined : scope;
  const thisYear = new Date().getFullYear();
  const years = [
    ...new Set([thisYear - 2, thisYear - 1, thisYear, thisYear + 1, report.year]),
  ].sort();
  const name = (r: { nameEn: string; nameAr: string }) => (locale === 'ar' ? r.nameAr : r.nameEn);
  const groupName = (code: number) => {
    const g = accountGroup(code);
    return g && tg.has(g.key) ? tg(g.key) : String(code);
  };
  const scopeName =
    scope === 'all'
      ? t('wholeCompany')
      : scope === 'company'
        ? t('companyWide')
        : (stores.find((s) => s.id === scope)?.code ?? '');

  const go = (next: { year?: number; scope?: string; group?: number | null }) => {
    const q = new URLSearchParams({
      year: String(next.year ?? report.year),
      scope: next.scope ?? scope,
    });
    const group = next.group === undefined ? report.groupCode : next.group;
    if (group) q.set('group', String(group));
    router.push(`?${q.toString()}`);
  };

  const saveQuarter = (row: Row, quarter: number, amountPiastres: number) =>
    void action.send('PUT', '/finance/budgets/quarter', {
      year: report.year,
      quarter,
      accountId: row.accountId,
      darkStoreId: storeId,
      amountPiastres,
    });
  const saveMonth = (row: Row, month: string, amountPiastres: number) =>
    void action.send('PUT', '/finance/budgets', {
      month,
      accountId: row.accountId,
      darkStoreId: storeId,
      amountPiastres,
    });

  const toggle = (q: number) =>
    setOpen((list) => (list.includes(q) ? list.filter((x) => x !== q) : [...list, q]));

  const head = (
    <tr>
      <th className={`${th} sticky start-0 z-10 bg-surface`}>{t('account')}</th>
      {QUARTERS.map((q) => (
        <Fragment key={q}>
          <th className={`${th} text-end`}>
            <button
              type="button"
              onClick={() => toggle(q)}
              aria-expanded={open.includes(q)}
              className="inline-flex items-center gap-1 font-bold uppercase text-link"
            >
              <span aria-hidden>{open.includes(q) ? '−' : '+'}</span>
              {t('quarter', { q })}
            </button>
          </th>
          {open.includes(q) &&
            report.income.months
              .filter((m) => Math.floor(monthIndex(m.month) / 3) + 1 === q)
              .map((m) => (
                <th key={m.month} className={`${th} bg-surface-raised text-end`}>
                  {t(`months.m${monthIndex(m.month) + 1}`)}
                </th>
              ))}
        </Fragment>
      ))}
      <th className={`${th} text-end`}>{t('yearTotal')}</th>
    </tr>
  );

  const cells = (
    quarters: (BudgetCell & { quarter: number })[],
    months: (BudgetCell & { month: string })[],
    year: BudgetCell,
    row?: Row,
  ) => (
    <>
      {QUARTERS.map((q, qi) => {
        const qc = quarters[qi]!;
        const edited = row?.quarters[qi]?.edited ?? false;
        return (
          <Fragment key={q}>
            <td className={td}>
              <CellView
                cell={qc}
                marker={edited ? <ByHand label={t('quarterByHand')} /> : undefined}
                input={
                  row && editable ? (
                    <BudgetInput
                      key={`${qc.budgetPiastres}`}
                      value={qc.budgetPiastres}
                      label={`${row.code} ${t('quarter', { q })}`}
                      disabled={action.busy}
                      onSave={(v) => saveQuarter(row, q, v)}
                    />
                  ) : undefined
                }
              />
            </td>
            {open.includes(q) &&
              months
                .filter((m) => Math.floor(monthIndex(m.month) / 3) + 1 === q)
                .map((m) => {
                  const manual = row?.months[monthIndex(m.month)]?.manual ?? false;
                  return (
                    <td key={m.month} className={`${td} bg-surface-raised`}>
                      <CellView
                        cell={m}
                        marker={manual ? <ByHand label={t('monthByHand')} /> : undefined}
                        input={
                          row && editable ? (
                            <BudgetInput
                              key={`${m.budgetPiastres}`}
                              value={m.budgetPiastres}
                              label={`${row.code} ${t(`months.m${monthIndex(m.month) + 1}`)}`}
                              disabled={action.busy}
                              onSave={(v) => saveMonth(row, m.month, v)}
                            />
                          ) : undefined
                        }
                      />
                    </td>
                  );
                })}
          </Fragment>
        );
      })}
      <td className={td}>
        <CellView cell={year} />
      </td>
    </>
  );

  const section = (category: 'revenue' | 'expense') => {
    const totals = category === 'revenue' ? report.income : report.costs;
    const rows = report.rows.filter(
      (r) =>
        r.category === category &&
        (!hideEmpty || r.year.budgetPiastres !== 0 || r.year.actualPiastres !== 0),
    );
    if (rows.length === 0 && report.rows.every((r) => r.category !== category)) return null;
    return (
      <section className="space-y-2">
        <h2 className="text-h3">{category === 'revenue' ? t('income') : t('costs')}</h2>
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-body-sm">
            <thead>{head}</thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.accountId} className="border-t border-line">
                  <td className={`${td} sticky start-0 z-10 min-w-44 bg-surface`}>
                    <span className="ltr-iso text-text-muted">{r.code}</span> {name(r)}
                  </td>
                  {cells(r.quarters, r.months, r.year, r)}
                </tr>
              ))}
              <tr className="border-t-2 border-line font-bold">
                <td className={`${td} sticky start-0 z-10 bg-surface`}>{t('total')}</td>
                {cells(totals.quarters, totals.months, totals.year)}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    );
  };

  const table = () => {
    const header = [
      t('code'),
      t('account'),
      t('kind'),
      t('period'),
      t('budget'),
      t('actual'),
      t('variance'),
      t('percent'),
    ];
    const lines = (
      code: string,
      label: string,
      kind: string,
      x: Pick<BudgetTotals, 'months' | 'quarters' | 'year'>,
    ) => {
      const line = (period: string, c: BudgetCell) => [
        code,
        label,
        kind,
        period,
        egp(c.budgetPiastres),
        egp(c.actualPiastres),
        egp(c.variancePiastres),
        c.percentBp === null ? null : c.percentBp / 100,
      ];
      return [
        ...QUARTERS.flatMap((q, qi) => [
          line(t('quarter', { q }), x.quarters[qi]!),
          ...x.months
            .filter((m) => Math.floor(monthIndex(m.month) / 3) + 1 === q)
            .map((m) => line(m.month, m)),
        ]),
        line(t('yearTotal'), x.year),
      ];
    };
    const kindOf = (c: 'revenue' | 'expense') => (c === 'revenue' ? t('income') : t('costs'));
    return {
      header,
      rows: [
        ...report.rows.flatMap((r) => lines(r.code, name(r), kindOf(r.category), r)),
        ...lines('', t('total'), t('income'), report.income),
        ...lines('', t('total'), t('costs'), report.costs),
        ...lines('', t('profit'), t('profit'), report.profit),
      ],
    };
  };
  const file = `budget-${report.year}`;

  return (
    <div className="mt-4 space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-caption">
          {t('year')}
          <select
            value={report.year}
            onChange={(e) => go({ year: Number(e.target.value) })}
            className={`${field} mt-1 block w-28`}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className="text-caption">
          {t('scope')}
          <select
            value={scope}
            onChange={(e) => go({ scope: e.target.value })}
            className={`${field} mt-1 block w-60`}
          >
            {canSeeAll && <option value="all">{t('wholeCompany')}</option>}
            {canSeeAll && <option value="company">{t('companyWide')}</option>}
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} {locale === 'ar' ? s.nameAr : s.nameEn}
              </option>
            ))}
          </select>
        </label>
        <label className="text-caption">
          {t('group')}
          <select
            value={report.groupCode ?? ''}
            onChange={(e) => go({ group: e.target.value ? Number(e.target.value) : null })}
            className={`${field} mt-1 block w-56`}
          >
            <option value="">{t('allGroups')}</option>
            {[...new Set([...report.groups, ...(report.groupCode ? [report.groupCode] : [])])]
              .sort((a, b) => a - b)
              .map((g) => (
                <option key={g} value={g}>
                  {g} {groupName(g)}
                </option>
              ))}
          </select>
        </label>
        <label className="flex h-10 items-center gap-2 text-body-sm">
          <input
            type="checkbox"
            checked={hideEmpty}
            onChange={(e) => setHideEmpty(e.target.checked)}
          />
          {t('hideEmpty')}
        </label>
        <div className="ms-auto flex flex-wrap items-end gap-2">
          <ExportMenu file={file} table={table} />
          {canEdit && <CopyYear year={report.year} scope={scope} scopeName={scopeName} />}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ['income', report.income.year],
            ['costs', report.costs.year],
            ['profit', report.profit.year],
          ] as const
        ).map(([k, c]) => (
          <div key={k} className="rounded-lg border border-line bg-surface p-4">
            <p className="text-label uppercase text-text-muted">{t(k)}</p>
            <p className="mt-1 text-h3">
              <Amount piastres={c.actualPiastres} />
            </p>
            <p className="text-caption text-text-muted">
              {t('ofBudget', { amount: formatEgp(c.budgetPiastres) })}
            </p>
          </div>
        ))}
      </div>

      <div className="space-y-1 text-caption text-text-muted">
        <p>{editable ? t('editHint') : scope === 'all' ? t('readOnlyHint') : t('viewOnlyHint')}</p>
        <p className="flex items-center gap-2">
          <ByHand label={t('monthByHand')} />
          {t('legend')}
        </p>
      </div>
      {action.message && <ActionMessage message={action.message} />}
      {section('revenue')}
      {section('expense')}
    </div>
  );
}

function ExportMenu({
  file,
  table,
}: {
  file: string;
  table: () => { header: string[]; rows: (string | number | null)[][] };
}) {
  const t = useTranslations('finance.budgetPlan');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const item =
    'flex min-h-10 w-full items-center rounded-md px-2 text-start text-body-sm hover:bg-surface-raised';
  return (
    <div ref={ref} className="relative print:hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={button}
      >
        {t('export')}
      </button>
      {open && (
        <ul className="absolute end-0 z-40 mt-1 w-48 rounded-lg border border-line bg-surface p-2 shadow-lg">
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
                    [
                      exportXlsx(x.header, x.rows, {
                        sheetName: file,
                        rtl: locale === 'ar',
                      }) as BlobPart,
                    ],
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

/** Copies last year's budget of this scope to the year shown, optionally raised by a percent. */
function CopyYear({ year, scope, scopeName }: { year: number; scope: string; scopeName: string }) {
  const t = useTranslations('finance.budgetPlan');
  const te = useTranslations('finance.merchants.errors');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [percent, setPercent] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [askReplace, setAskReplace] = useState(false);
  // Percent typed like "5" or "-2.5": hundredths of a percent are basis points.
  const percentBp = percent.trim() === '' ? 0 : parseEgp(percent, { allowNegative: true });

  const copy = async (replace: boolean) => {
    if (percentBp === null) return;
    setBusy(true);
    setMessage(null);
    const result = await apiSend<{ copied: number; replaced: number }>(
      'POST',
      '/finance/budgets/copy',
      { fromYear: year - 1, toYear: year, scope, percentBp, replace },
    );
    setBusy(false);
    if (!result.ok) {
      if (result.error === 'budget_year_not_empty') {
        setAskReplace(true);
        return;
      }
      setMessage({
        text: te.has(result.error) ? te(result.error) : te('generic'),
        error: true,
      });
      return;
    }
    setAskReplace(false);
    setMessage({ text: t('copied', { count: result.data.copied }), error: false });
    router.refresh();
  };

  if (!open)
    return (
      <button type="button" className={button} onClick={() => setOpen(true)}>
        {t('copyOpen', { from: year - 1 })}
      </button>
    );
  return (
    <div className="w-full max-w-md space-y-2 rounded-lg border border-line bg-surface p-3 sm:w-auto">
      <p className="text-body-sm">
        {t('copyIntro', { from: year - 1, to: year, scope: scopeName })}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-caption">
          {t('copyPercent')}
          <input
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            inputMode="decimal"
            dir="ltr"
            placeholder="0"
            aria-invalid={percentBp === null}
            className={`${field} mt-1 block w-24 text-end`}
          />
        </label>
        <button
          type="button"
          className={button}
          disabled={busy || percentBp === null}
          onClick={() => void copy(false)}
        >
          {t('copyButton', { from: year - 1, to: year })}
        </button>
        <button
          type="button"
          className="h-10 px-2 text-body-sm text-link"
          onClick={() => setOpen(false)}
        >
          {t('cancel')}
        </button>
      </div>
      {askReplace && (
        <div className="flex flex-wrap items-center gap-2 text-body-sm">
          <span>{t('copyReplace', { to: year })}</span>
          <button type="button" className={button} disabled={busy} onClick={() => void copy(true)}>
            {t('replace')}
          </button>
        </div>
      )}
      {message && <ActionMessage message={message} />}
    </div>
  );
}
