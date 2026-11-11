'use client';

import {
  daysInMonth,
  exportCsv,
  type ExportCell,
  exportXlsx,
  FORECAST_BP_DRIVERS,
  FORECAST_COUNT_DRIVERS,
  FORECAST_LEVEL_DRIVERS,
  type ForecastBalanceSheet,
  type ForecastCashFlow,
  type ForecastDriverRow,
  type ForecastOpening,
  type ForecastOverrideRow,
  type ForecastPeriodTotals,
  type ForecastResult,
  forecastCompute,
  forecastPeriods,
  forecastPeriodTotals,
} from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { download } from '@/components/odoo/ListView';
import { useUnsavedChanges } from '@/components/workflow/useUnsavedChanges';
import { apiGetClient, apiSend } from '@/lib/api-client';
import { formatCount, formatEgp } from '@/lib/format';
import { parseEgp } from '@/lib/money';
import { Amount } from './Amount';

// Forecast (Accounting > Planning): the list of scenarios and one scenario's editor. Every
// change recalculates at once in the browser with forecastCompute, the same function the API
// uses; Save sends the changed drivers and hand edits in one go.

export interface ForecastHead {
  id: string;
  number: string;
  name: string;
  status: 'draft' | 'approved';
  startMonth: string;
  basedOnFrom: string | null;
  basedOnTo: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
  approvedBy: { id: string; name: string } | null;
  approvedAt: string | null;
  copiedFrom: { id: string; number: string; name: string } | null;
}
export interface ForecastSummary {
  revenuePiastres: number;
  profitPiastres: number;
  orders: number;
  cashEndPiastres: number;
  lowestCashPiastres: number;
  warnings: number;
}
export type ForecastListRow = ForecastHead & ForecastSummary;
export interface ForecastAccount {
  id: string;
  key: string | null;
  code: string;
  nameEn: string | null;
  nameAr: string | null;
  category: 'revenue' | 'expense';
  isActive: boolean;
}
export interface ForecastOverrideView extends ForecastOverrideRow {
  note: string | null;
  updatedAt: string;
  updatedBy: { id: string; name: string };
}
export interface ForecastDetailData {
  forecast: ForecastHead;
  opening: ForecastOpening;
  months: string[];
  drivers: ForecastDriverRow[];
  overrides: ForecastOverrideView[];
  accounts: ForecastAccount[];
  result: ForecastResult;
  summary: ForecastSummary;
}
interface CompareRow extends ForecastListRow {
  months: {
    month: string;
    orders: number;
    revenue: number;
    expenses: number;
    profit: number;
    cashEnd: number;
  }[];
}
interface BudgetPreview {
  months: string[];
  rows: {
    month: string;
    accountId: string | null;
    accountKey: string | null;
    code: string | null;
    nameEn: string | null;
    nameAr: string | null;
    category: 'revenue' | 'expense';
    amountPiastres: number;
    existingPiastres: number | null;
  }[];
  existing: number;
  negative: number;
}

const field = 'h-10 rounded-md border border-line bg-surface px-2 text-body-sm';
const primary =
  'h-10 rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary active:bg-primary-pressed disabled:opacity-50';
const secondary =
  'h-10 rounded-md border border-line px-3 text-body-sm font-bold disabled:opacity-50';
const th = 'whitespace-nowrap px-2 py-2 text-end text-label uppercase text-text-muted';
const thStart =
  'sticky start-0 z-10 bg-surface px-2 py-2 text-start text-label uppercase text-text-muted';
const tdName = 'sticky start-0 z-10 bg-surface px-2 py-1.5 text-start';
const td = 'whitespace-nowrap px-2 py-1.5 text-end';

/** Fee kinds a fee per order driver may name (entry kinds booked on fee income). */
const FEE_KINDS = [
  'shipping_fee',
  'order_fee',
  'product_handling',
  'cod_fee',
  'packaging_charge',
  'failed_fee',
  'receiving_fee',
  'storage_fee',
  'return_fee',
];
/** Accounts that have their own driver line, never added as a fixed line. */
const DRIVER_ACCOUNT_KEYS = new Set([
  'revenue',
  'rider_bonus_expense',
  'rider_office_commission',
  'postal_fee_expense',
  'expense:packaging',
  'expense:salaries',
  'expense:rent',
  'depreciation_expense',
  'loan_interest_expense',
]);

const LEVEL = new Set<string>(FORECAST_LEVEL_DRIVERS);
const isLevel = (key: string) => LEVEL.has(key) || /^(fee|fixed):/.test(key);
type Unit = 'money' | 'count' | 'percent';
const unitOf = (key: string): Unit =>
  FORECAST_COUNT_DRIVERS.has(key) ? 'count' : FORECAST_BP_DRIVERS.has(key) ? 'percent' : 'money';

function formatValue(value: number, unit: Unit) {
  if (unit === 'count') return formatCount(value);
  if (unit === 'percent') return `${(value / 100).toFixed(2)}%`;
  return formatEgp(value);
}
/** What a person typed, as the stored integer (piastres, a count or basis points). */
function parseValue(text: string, unit: Unit): number | null {
  const clean = text.trim().replace(/,/g, '').replace(/%$/, '');
  if (unit === 'count') return /^-?\d+$/.test(clean) ? Number(clean) : null;
  // Percent: 12.5 is 1,250 basis points, the same two decimals as EGP in piastres.
  return parseEgp(clean, { allowNegative: true });
}

function useNames(accounts: ForecastAccount[]) {
  const t = useTranslations('forecast');
  const tf = useTranslations('finance');
  const locale = useLocale();
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const accountName = (a: ForecastAccount) =>
    `${a.code} ${(locale === 'ar' ? a.nameAr : a.nameEn) ?? a.nameEn ?? a.key ?? ''}`.trim();
  const kindName = (kind: string) => (tf.has(`kinds.${kind}`) ? tf(`kinds.${kind}`) : kind);
  const line = (key: string) => {
    if (key.startsWith('fee:')) return kindName(key.slice(4));
    if (key.startsWith('fixed:')) {
      const a = byId.get(key.slice(6));
      return a ? accountName(a) : t('unknownAccount');
    }
    return t(`lines.${key}`);
  };
  const driver = (key: string) => {
    if (key.startsWith('fee:')) return t('drivers.feePerOrder', { kind: kindName(key.slice(4)) });
    if (key.startsWith('fixed:')) return line(key);
    return t(`drivers.${key}`);
  };
  return { line, driver, accountName, kindName, monthName: (m: string) => monthLabel(m, locale) };
}

function monthLabel(m: string, locale: string) {
  const [y, mm] = m.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString(
    locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB',
    { month: 'short', year: '2-digit', timeZone: 'UTC' },
  );
}

function errorText(t: ReturnType<typeof useTranslations>, code: string) {
  return t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic');
}

// ─── list ─────────────────────────────────────────────────────────────────────

export function ForecastList({ rows, canUse }: { rows: ForecastListRow[]; canUse: boolean }) {
  const t = useTranslations('forecast');
  const locale = useLocale();
  const router = useRouter();
  const [name, setName] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    const r = await apiSend<{ id: string }>('POST', '/finance/forecasts', {
      name,
      ...(copyFrom ? { copyFromId: copyFrom } : {}),
    });
    setBusy(false);
    if (!r.ok) return setError(errorText(t, r.error));
    router.push(`/finance/forecast/${r.data.id}`);
  }

  return (
    <div className="mt-4 space-y-6">
      {canUse && (
        <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-h3">{t('newTitle')}</h2>
          <p className="text-body-sm text-text-muted">{t('newIntro')}</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-caption">
              {t('name')}
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('namePlaceholder')}
                className={`${field} mt-1 block w-64`}
              />
            </label>
            <label className="text-caption">
              {t('startFrom')}
              <select
                value={copyFrom}
                onChange={(e) => setCopyFrom(e.target.value)}
                className={`${field} mt-1 block w-72`}
              >
                <option value="">{t('fromSuggestion')}</option>
                {rows.map((r) => (
                  <option key={r.id} value={r.id}>
                    {t('copyOf', { name: `${r.number} ${r.name}` })}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={primary}
              disabled={busy || name.trim().length < 2}
              onClick={() => void create()}
            >
              {t('create')}
            </button>
          </div>
          {error && (
            <p role="alert" className="text-body-sm text-danger">
              {error}
            </p>
          )}
        </section>
      )}
      {rows.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-6 text-body-sm text-text-muted">
          {t('empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-body-sm">
            <thead>
              <tr>
                <th className="px-3 py-2 text-start text-label uppercase text-text-muted">
                  {t('scenario')}
                </th>
                <th className="px-3 py-2 text-start text-label uppercase text-text-muted">
                  {t('status')}
                </th>
                <th className="px-3 py-2 text-start text-label uppercase text-text-muted">
                  {t('firstMonth')}
                </th>
                <th className={th}>{t('yearRevenue')}</th>
                <th className={th}>{t('yearProfit')}</th>
                <th className={th}>{t('cashAtEnd')}</th>
                <th className={th}>{t('lowestCash')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="px-3 py-2">
                    <Link href={`/finance/forecast/${r.id}`} className="font-bold text-link">
                      <span className="ltr-iso">{r.number}</span> {r.name}
                    </Link>
                    <p className="text-caption text-text-muted">
                      {r.copiedFrom
                        ? t('copiedFrom', { name: r.copiedFrom.number })
                        : r.basedOnTo
                          ? t('basedOn', {
                              from: monthLabel(r.basedOnFrom!, locale),
                              to: monthLabel(r.basedOnTo, locale),
                            })
                          : t('basedOnNothing')}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-3 py-2">{monthLabel(r.startMonth, locale)}</td>
                  <td className={td}>
                    <Amount piastres={r.revenuePiastres} />
                  </td>
                  <td className={td}>
                    <Amount piastres={r.profitPiastres} strong />
                  </td>
                  <td className={td}>
                    <Amount piastres={r.cashEndPiastres} />
                  </td>
                  <td className={td}>
                    <Amount piastres={r.lowestCashPiastres} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: 'draft' | 'approved' }) {
  const t = useTranslations('forecast');
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-caption font-bold ${
        status === 'approved'
          ? 'bg-status-delivered/15 text-status-delivered'
          : 'bg-text-muted/15 text-text-muted'
      }`}
    >
      {t(`statuses.${status}`)}
    </span>
  );
}

// ─── editor ───────────────────────────────────────────────────────────────────

const TABS = ['drivers', 'pl', 'bs', 'cf', 'compare'] as const;
type Tab = (typeof TABS)[number];

export function ForecastEditor({
  detail,
  scenarios,
  initialTab,
  canUse,
  canManage,
}: {
  detail: ForecastDetailData;
  scenarios: ForecastListRow[];
  initialTab: string | undefined;
  canUse: boolean;
  canManage: boolean;
}) {
  const t = useTranslations('forecast');
  const router = useRouter();
  const names = useNames(detail.accounts);
  const f = detail.forecast;
  const editable = canUse && f.status === 'draft';
  const [tab, setTab] = useState<Tab>(
    TABS.includes(initialTab as Tab) ? (initialTab as Tab) : 'drivers',
  );
  const [drivers, setDrivers] = useState(detail.drivers);
  const [overrides, setOverrides] = useState<ForecastOverrideView[]>(detail.overrides);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [budget, setBudget] = useState<BudgetPreview | null>(null);

  // A save or another person's change reloads the page data: start again from it.
  useEffect(() => {
    setDrivers(detail.drivers);
    setOverrides(detail.overrides);
  }, [detail]);

  const accounts = useMemo(
    () => detail.accounts.map((a) => ({ id: a.id, category: a.category })),
    [detail.accounts],
  );
  const result = useMemo(
    () =>
      forecastCompute({
        startMonth: f.startMonth,
        drivers,
        overrides,
        opening: detail.opening,
        accounts,
      }),
    [f.startMonth, drivers, overrides, detail.opening, accounts],
  );
  const periods = useMemo(() => forecastPeriods(detail.months), [detail.months]);
  const totals = useMemo(
    () => periods.map((p) => forecastPeriodTotals(result, p)),
    [periods, result],
  );

  const driverChanges = useMemo(() => {
    const before = new Map(detail.drivers.map((d) => [`${d.month}|${d.key}`, d.value]));
    const after = new Map(drivers.map((d) => [`${d.month}|${d.key}`, d.value]));
    const out: { month: string; key: string; value: number | null }[] = [];
    for (const [k, v] of after)
      if (before.get(k) !== v) {
        const [month, key] = k.split('|') as [string, string];
        out.push({ month, key, value: v });
      }
    for (const k of before.keys())
      if (!after.has(k)) {
        const [month, key] = k.split('|') as [string, string];
        out.push({ month, key, value: null });
      }
    return out;
  }, [detail.drivers, drivers]);
  const overrideChanges = useMemo(() => {
    const before = new Map(detail.overrides.map((o) => [`${o.month}|${o.lineKey}`, o]));
    const after = new Map(overrides.map((o) => [`${o.month}|${o.lineKey}`, o]));
    const out: { month: string; lineKey: string; amountPiastres: number | null; note?: string }[] =
      [];
    for (const [k, o] of after)
      if (before.get(k)?.amountPiastres !== o.amountPiastres)
        out.push({
          month: o.month,
          lineKey: o.lineKey,
          amountPiastres: o.amountPiastres,
          ...(note.trim() ? { note: note.trim() } : {}),
        });
    for (const [k, o] of before)
      if (!after.has(k)) out.push({ month: o.month, lineKey: o.lineKey, amountPiastres: null });
    return out;
  }, [detail.overrides, overrides, note]);
  const dirty = driverChanges.length > 0 || overrideChanges.length > 0;
  useUnsavedChanges(dirty);

  function chooseTab(next: Tab) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url.toString());
  }

  function setDriver(month: string, key: string, value: number | null) {
    setDrivers((list) => {
      const rest = list.filter((d) => !(d.month === month && d.key === key));
      return value === null ? rest : [...rest, { month, key, value }];
    });
  }
  function setOverride(month: string, lineKey: string, amount: number | null) {
    setOverrides((list) => {
      const rest = list.filter((o) => !(o.month === month && o.lineKey === lineKey));
      if (amount === null) return rest;
      const old = list.find((o) => o.month === month && o.lineKey === lineKey);
      return [
        ...rest,
        {
          month,
          lineKey,
          amountPiastres: amount,
          note: old?.note ?? null,
          updatedAt: old?.updatedAt ?? new Date().toISOString(),
          updatedBy: old?.updatedBy ?? { id: '', name: t('you') },
        },
      ];
    });
  }

  async function run<T>(
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T | null> {
    setBusy(true);
    setMessage(null);
    const r = await apiSend<T>(method, path, body);
    setBusy(false);
    if (!r.ok) {
      setMessage({ text: errorText(t, r.error), error: true });
      return null;
    }
    return r.data;
  }

  async function save() {
    if (driverChanges.length) {
      const ok = await run('PUT', `/finance/forecasts/${f.id}/drivers`, {
        changes: driverChanges,
      });
      if (ok === null) return;
    }
    if (overrideChanges.length) {
      const ok = await run('PUT', `/finance/forecasts/${f.id}/overrides`, {
        changes: overrideChanges,
      });
      if (ok === null) return;
    }
    setNote('');
    setMessage({ text: t('saved'), error: false });
    router.refresh();
  }

  async function status(action: 'approve' | 'reopen') {
    if (await run('POST', `/finance/forecasts/${f.id}/${action}`)) {
      setMessage({ text: t(action === 'approve' ? 'approvedDone' : 'reopenedDone'), error: false });
      router.refresh();
    }
  }

  async function copy() {
    const name = window.prompt(t('copyName'), `${f.name} ${t('copySuffix')}`);
    if (!name) return;
    const r = await run<{ id: string }>('POST', '/finance/forecasts', {
      name,
      copyFromId: f.id,
    });
    if (r) router.push(`/finance/forecast/${r.id}`);
  }

  async function remove() {
    if (!window.confirm(t('deleteConfirm'))) return;
    if (await run('DELETE', `/finance/forecasts/${f.id}`)) router.push('/finance/forecast');
  }

  async function rename() {
    const name = window.prompt(t('renamePrompt'), f.name);
    if (!name || name.trim() === f.name) return;
    if (await run('PATCH', `/finance/forecasts/${f.id}`, { name })) router.refresh();
  }

  async function openBudget() {
    setMessage(null);
    const r = await apiGetClient<BudgetPreview>(`/finance/forecasts/${f.id}/budget-preview`);
    if (!r.ok) return setMessage({ text: errorText(t, r.error), error: true });
    setBudget(r.data);
  }

  async function toBudget(mode: 'replace' | 'skip') {
    const r = await run<{
      written: number;
      skippedExisting: number;
      skippedNegative: number;
      skippedNoAccount: number;
    }>('POST', `/finance/forecasts/${f.id}/to-budget`, { mode });
    if (!r) return;
    setBudget(null);
    setMessage({
      text: t('budgetDone', {
        written: r.written,
        skipped: r.skippedExisting + r.skippedNegative + r.skippedNoAccount,
      }),
      error: false,
    });
  }

  function exportTab(format: 'csv' | 'xlsx') {
    const table = tableOf(tab, result, totals, names, t, detail.opening, drivers);
    if (!table) return;
    const stamp = new Date().toISOString().slice(0, 10);
    const file = `${f.number}-${tab}-${stamp}`;
    if (format === 'csv')
      download(
        `${file}.csv`,
        new Blob([exportCsv(table.header, table.rows)], { type: 'text/csv;charset=utf-8' }),
      );
    else
      download(
        `${file}.xlsx`,
        new Blob([exportXlsx(table.header, table.rows, { sheetName: f.number }) as BlobPart], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      );
  }

  const periodLabel = (key: string) =>
    key.startsWith('m:')
      ? names.monthName(key.slice(2))
      : key === 'year'
        ? t('year')
        : key.toUpperCase();

  return (
    <div className="mt-4 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-caption text-text-muted">
            <Link href="/finance/forecast" className="text-link print:hidden">
              {t('title')}
            </Link>{' '}
            <span className="ltr-iso">{f.number}</span>
          </p>
          <h1 className="flex flex-wrap items-center gap-2 text-h2">
            {f.name} <StatusPill status={f.status} />
          </h1>
          <p className="mt-1 text-body-sm text-text-muted">
            {f.copiedFrom
              ? t('copiedFrom', { name: `${f.copiedFrom.number} ${f.copiedFrom.name}` })
              : f.basedOnTo
                ? t('basedOn', {
                    from: names.monthName(f.basedOnFrom!),
                    to: names.monthName(f.basedOnTo),
                  })
                : t('basedOnNothing')}{' '}
            {f.approvedBy && t('approvedBy', { name: f.approvedBy.name })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {editable && (
            <button type="button" className={primary} disabled={busy || !dirty} onClick={save}>
              {t('save')}
            </button>
          )}
          {editable && dirty && (
            <button
              type="button"
              className={secondary}
              disabled={busy}
              onClick={() => {
                setDrivers(detail.drivers);
                setOverrides(detail.overrides);
              }}
            >
              {t('discard')}
            </button>
          )}
          {canManage && f.status === 'draft' && (
            <button
              type="button"
              className={secondary}
              disabled={busy || dirty}
              onClick={() => void status('approve')}
            >
              {t('approve')}
            </button>
          )}
          {canManage && f.status === 'approved' && (
            <>
              <button
                type="button"
                className={primary}
                disabled={busy}
                onClick={() => void openBudget()}
              >
                {t('useAsBudget')}
              </button>
              <button
                type="button"
                className={secondary}
                disabled={busy}
                onClick={() => void status('reopen')}
              >
                {t('reopen')}
              </button>
            </>
          )}
          {canUse && (
            <>
              <button type="button" className={secondary} disabled={busy} onClick={copy}>
                {t('copy')}
              </button>
              <button type="button" className={secondary} disabled={busy} onClick={rename}>
                {t('rename')}
              </button>
            </>
          )}
          {editable && (
            <button type="button" className={secondary} disabled={busy} onClick={remove}>
              {t('delete')}
            </button>
          )}
        </div>
      </header>

      {dirty && (
        <p className="text-body-sm font-bold text-text-muted print:hidden">{t('unsaved')}</p>
      )}
      {message && (
        <p
          role="status"
          className={`text-body-sm ${message.error ? 'text-danger' : 'text-text-muted'}`}
        >
          {message.text}
        </p>
      )}

      {budget && (
        <BudgetPanel
          preview={budget}
          names={names}
          busy={busy}
          onCancel={() => setBudget(null)}
          onApply={(mode) => void toBudget(mode)}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label={t('yearRevenue')}>
          <Amount piastres={totals.at(-1)!.revenue} />
        </Stat>
        <Stat label={t('yearProfit')}>
          <Amount piastres={totals.at(-1)!.profit} strong />
        </Stat>
        <Stat label={t('cashAtEnd')}>
          <Amount piastres={totals.at(-1)!.balanceSheet.cash} />
        </Stat>
        <Stat label={t('yearOrders')}>{formatCount(totals.at(-1)!.orders)}</Stat>
      </div>

      {result.warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-danger/40 bg-danger/5 p-3 text-body-sm">
          {result.warnings.map((w) => (
            <li key={`${w.month}${w.code}`} className="text-danger">
              {t(`warnings.${w.code}`, {
                month: names.monthName(w.month),
                amount: formatEgp(Math.abs(w.amount)),
              })}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div role="tablist" className="flex flex-wrap gap-1">
          {TABS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => chooseTab(k)}
              className={`h-10 rounded-md px-3 text-body-sm font-bold ${
                tab === k ? 'bg-primary text-on-primary' : 'border border-line'
              }`}
            >
              {t(`tabs.${k}`)}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {tab !== 'compare' && (
            <>
              <button type="button" className={secondary} onClick={() => exportTab('csv')}>
                {t('exportCsv')}
              </button>
              <button type="button" className={secondary} onClick={() => exportTab('xlsx')}>
                {t('exportExcel')}
              </button>
            </>
          )}
          <button type="button" className={secondary} onClick={() => window.print()}>
            {t('print')}
          </button>
        </div>
      </div>

      {editable && (tab === 'pl' || tab === 'drivers') && (
        <p className="text-body-sm text-text-muted print:hidden">
          {tab === 'drivers' ? t('driversHint') : t('linesHint')}
        </p>
      )}
      {editable && tab === 'pl' && (
        <label className="block text-caption print:hidden">
          {t('editNote')}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            className={`${field} mt-1 block w-full max-w-lg`}
          />
        </label>
      )}

      {tab === 'drivers' && (
        <DriversGrid
          months={detail.months}
          drivers={drivers}
          result={result}
          accounts={detail.accounts}
          editable={editable}
          names={names}
          onChange={setDriver}
        />
      )}
      {tab === 'pl' && (
        <ProfitGrid
          result={result}
          totals={totals}
          overrides={overrides}
          editable={editable}
          names={names}
          periodLabel={periodLabel}
          onChange={setOverride}
        />
      )}
      {tab === 'bs' && (
        <StatementGrid
          kind="bs"
          totals={totals}
          opening={detail.opening}
          periodLabel={periodLabel}
        />
      )}
      {tab === 'cf' && (
        <StatementGrid
          kind="cf"
          totals={totals}
          opening={detail.opening}
          periodLabel={periodLabel}
        />
      )}
      {tab === 'compare' && <Compare current={f.id} scenarios={scenarios} names={names} />}
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="text-label uppercase text-text-muted">{label}</p>
      <p className="mt-1 text-h3">{children}</p>
    </div>
  );
}

type Names = ReturnType<typeof useNames>;

// ─── grids ────────────────────────────────────────────────────────────────────

/** A cell that shows a value and turns into an input when tapped. */
function EditCell({
  value,
  unit,
  marked,
  muted,
  editable,
  title,
  onCommit,
}: {
  value: number;
  unit: Unit;
  marked?: boolean;
  muted?: boolean;
  editable: boolean;
  title?: string;
  /** null clears the cell (empty input) */
  onCommit: (value: number | null) => void;
}) {
  const t = useTranslations('forecast');
  const [text, setText] = useState<string | null>(null);
  const shown = (
    <span
      className={`ltr-iso ${muted ? 'text-text-muted' : 'font-bold'} ${value < 0 ? 'text-danger' : ''}`}
    >
      {formatValue(value, unit)}
    </span>
  );
  const cls = `${td} ${marked ? 'bg-status-needs-action/15' : ''}`;
  if (!editable)
    return (
      <td className={cls} title={title}>
        {shown}
      </td>
    );
  if (text === null)
    return (
      <td className={cls} title={title}>
        <button
          type="button"
          className="w-full text-end"
          onClick={() => setText(unit === 'count' ? String(value) : (value / 100).toFixed(2))}
          aria-label={t('editCell')}
        >
          {shown}
        </button>
      </td>
    );
  const commit = () => {
    if (text.trim() === '') onCommit(null);
    else {
      const v = parseValue(text, unit);
      if (v !== null) onCommit(v);
    }
    setText(null);
  };
  return (
    <td className={cls}>
      <input
        autoFocus
        value={text}
        dir="ltr"
        inputMode="decimal"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setText(null);
        }}
        className={`${field} h-8 w-28 text-end ${parseValue(text, unit) === null && text.trim() !== '' ? 'border-danger' : ''}`}
      />
    </td>
  );
}

const driverMap = (drivers: ForecastDriverRow[]) =>
  new Map(drivers.map((d) => [`${d.month}|${d.key}`, d.value]));

/** The drivers grid's groups: fixed drivers plus every fee kind and account named. */
function driverGroups(drivers: ForecastDriverRow[]) {
  const named = [...new Set(drivers.map((d) => d.key))];
  return [
    { id: 'volume', keys: ['orders', 'growth_bp', 'new_merchants', 'orders_per_new_merchant'] },
    { id: 'fees', keys: named.filter((k) => k.startsWith('fee:')).sort() },
    {
      id: 'cash',
      keys: [
        'cod_share_bp',
        'cod_per_order',
        'merchant_hold_days',
        'rider_cash_end',
        'vat_bp',
        'vat_input',
      ],
    },
    {
      id: 'costs',
      keys: [
        'rider_pay_per_order',
        'office_commission_per_order',
        'postal_per_order',
        'packaging_per_order',
        'salaries',
        'rent',
        ...named.filter((k) => k.startsWith('fixed:')).sort(),
      ],
    },
    {
      id: 'investing',
      keys: [
        'capex',
        'depreciation',
        'loans_in',
        'loan_principal',
        'loan_interest',
        'capital_in',
        'drawings',
      ],
    },
  ];
}

/** The value a month uses: its own, else (level drivers) the last one set before it. */
function driverValue(
  set: Map<string, number>,
  months: string[],
  result: ForecastResult,
  key: string,
  i: number,
): { value: number; own: boolean } {
  const own = set.get(`${months[i]}|${key}`);
  if (own !== undefined) return { value: own, own: true };
  if (key === 'orders') return { value: result.months[i]?.orders ?? 0, own: false };
  if (key === 'rider_cash_end')
    return { value: result.months[i]?.balanceSheet.riderCash ?? 0, own: false };
  if (!isLevel(key)) return { value: 0, own: false };
  for (let j = i - 1; j >= 0; j--) {
    const v = set.get(`${months[j]}|${key}`);
    if (v !== undefined) return { value: v, own: false };
  }
  return { value: 0, own: false };
}

function DriversGrid({
  months,
  drivers,
  result,
  accounts,
  editable,
  names,
  onChange,
}: {
  months: string[];
  drivers: ForecastDriverRow[];
  result: ForecastResult;
  accounts: ForecastAccount[];
  editable: boolean;
  names: Names;
  onChange: (month: string, key: string, value: number | null) => void;
}) {
  const t = useTranslations('forecast');
  const set = useMemo(() => driverMap(drivers), [drivers]);
  const named = new Set(drivers.map((d) => d.key));
  const groups = driverGroups(drivers).map((g) => ({ ...g, title: t(`groups.${g.id}`) }));
  const effective = (key: string, i: number) => driverValue(set, months, result, key, i);
  const addable = accounts.filter(
    (a) => a.isActive && !(a.key && DRIVER_ACCOUNT_KEYS.has(a.key)) && !named.has(`fixed:${a.id}`),
  );
  const fees = FEE_KINDS.filter((k) => !named.has(`fee:${k}`));
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr>
              <th className={thStart}>{t('driver')}</th>
              {months.map((m) => (
                <th key={m} className={th}>
                  {names.monthName(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <DriverGroup key={g.title} title={g.title} span={months.length + 1}>
                {g.keys.map((key) => (
                  <tr key={key} className="border-t border-line">
                    <td className={tdName}>
                      {names.driver(key)}
                      {key === 'orders' && (
                        <span className="block text-caption text-text-muted">
                          {t('perDay', {
                            count: formatCount(
                              Math.round((result.months[0]?.orders ?? 0) / daysInMonth(months[0]!)),
                            ),
                          })}
                        </span>
                      )}
                    </td>
                    {months.map((m, i) => {
                      const e = effective(key, i);
                      return (
                        <EditCell
                          key={m}
                          value={e.value}
                          unit={unitOf(key)}
                          muted={!e.own}
                          editable={editable}
                          onCommit={(v) => onChange(m, key, v)}
                        />
                      );
                    })}
                  </tr>
                ))}
              </DriverGroup>
            ))}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className="flex flex-wrap gap-3 print:hidden">
          <select
            className={`${field} w-64`}
            value=""
            onChange={(e) => e.target.value && onChange(months[0]!, `fee:${e.target.value}`, 0)}
            aria-label={t('addFee')}
          >
            <option value="">{t('addFee')}</option>
            {fees.map((k) => (
              <option key={k} value={k}>
                {names.kindName(k)}
              </option>
            ))}
          </select>
          <select
            className={`${field} w-72`}
            value=""
            onChange={(e) => e.target.value && onChange(months[0]!, `fixed:${e.target.value}`, 0)}
            aria-label={t('addAccount')}
          >
            <option value="">{t('addAccount')}</option>
            {addable.map((a) => (
              <option key={a.id} value={a.id}>
                {names.accountName(a)}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

function DriverGroup({
  title,
  span,
  children,
}: {
  title: string;
  span: number;
  children: ReactNode;
}) {
  return (
    <>
      <tr className="border-t border-line bg-bg">
        <td colSpan={span} className="px-2 py-1.5 text-label uppercase text-text-muted">
          {title}
        </td>
      </tr>
      {children}
    </>
  );
}

function ProfitGrid({
  result,
  totals,
  overrides,
  editable,
  names,
  periodLabel,
  onChange,
}: {
  result: ForecastResult;
  totals: ForecastPeriodTotals[];
  overrides: ForecastOverrideView[];
  editable: boolean;
  names: Names;
  periodLabel: (key: string) => string;
  onChange: (month: string, lineKey: string, amount: number | null) => void;
}) {
  const t = useTranslations('forecast');
  const over = new Map(overrides.map((o) => [`${o.month}|${o.lineKey}`, o]));
  const section = (category: 'revenue' | 'expense') =>
    result.lines.filter((l) => l.category === category);
  const totalRow = (label: string, get: (p: ForecastPeriodTotals) => number, strong = true) => (
    <tr className="border-t border-line bg-bg">
      <td className={`${tdName} bg-bg font-bold`}>{label}</td>
      {totals.map((p) => (
        <td key={p.key} className={td}>
          <Amount piastres={get(p)} strong={strong} />
        </td>
      ))}
    </tr>
  );
  const lineRows = (category: 'revenue' | 'expense') =>
    section(category).map((line) => (
      <tr key={line.key} className="border-t border-line">
        <td className={tdName}>{names.line(line.key)}</td>
        {totals.map((p) => {
          if (!p.key.startsWith('m:'))
            return (
              <td
                key={p.key}
                className={`${td} ${p.edited.includes(line.key) ? 'bg-status-needs-action/15' : ''}`}
              >
                <Amount piastres={p.lines[line.key] ?? 0} />
              </td>
            );
          const month = p.key.slice(2);
          const o = over.get(`${month}|${line.key}`);
          return (
            <EditCell
              key={p.key}
              value={p.lines[line.key] ?? 0}
              unit="money"
              marked={!!o}
              editable={editable}
              title={
                o
                  ? t('editedBy', { name: o.updatedBy.name, note: o.note ?? t('noNote') })
                  : undefined
              }
              onCommit={(v) => onChange(month, line.key, v)}
            />
          );
        })}
      </tr>
    ));
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-body-sm">
          <thead>
            <tr>
              <th className={thStart}>{t('line')}</th>
              {totals.map((p) => (
                <th key={p.key} className={th}>
                  {periodLabel(p.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-line">
              <td className={tdName}>{t('orders')}</td>
              {totals.map((p) => (
                <td key={p.key} className={td}>
                  {formatCount(p.orders)}
                </td>
              ))}
            </tr>
            {lineRows('revenue')}
            {totalRow(t('totalRevenue'), (p) => p.revenue)}
            {lineRows('expense')}
            {totalRow(t('totalCosts'), (p) => p.expenses)}
            {totalRow(t('profit'), (p) => p.profit)}
          </tbody>
        </table>
      </div>
      <p className="text-caption text-text-muted">
        <span className="inline-block h-3 w-3 rounded-sm bg-status-needs-action/15 align-middle" />{' '}
        {t('editedLegend')}
      </p>
    </div>
  );
}

const BS_ROWS: { key: keyof ForecastBalanceSheet | 'check'; total?: boolean }[] = [
  { key: 'cash' },
  { key: 'riderCash' },
  { key: 'fixedAssets' },
  { key: 'otherAssets' },
  { key: 'totalAssets', total: true },
  { key: 'merchants' },
  { key: 'vatPayable' },
  { key: 'loans' },
  { key: 'otherLiabilities' },
  { key: 'totalLiabilities', total: true },
  { key: 'capital' },
  { key: 'retainedEarnings' },
  { key: 'totalEquity', total: true },
  { key: 'check', total: true },
];
const CF_ROWS: { key: keyof ForecastCashFlow; total?: boolean }[] = [
  { key: 'profit' },
  { key: 'depreciation' },
  { key: 'merchantsChange' },
  { key: 'vatChange' },
  { key: 'riderCashChange' },
  { key: 'operating', total: true },
  { key: 'capex' },
  { key: 'investing', total: true },
  { key: 'loansIn' },
  { key: 'loanRepayments' },
  { key: 'capitalIn' },
  { key: 'drawings' },
  { key: 'financing', total: true },
  { key: 'netChange', total: true },
  { key: 'cashStart' },
  { key: 'cashEnd', total: true },
];
/** Rows shown as money going out (taken away in the cash flow). */
const CF_OUT = new Set<keyof ForecastCashFlow>([
  'riderCashChange',
  'capex',
  'loanRepayments',
  'drawings',
]);

function bsValue(b: ForecastBalanceSheet, key: keyof ForecastBalanceSheet | 'check') {
  return key === 'check' ? b.totalLiabilities + b.totalEquity : b[key];
}
function openingSheet(o: ForecastOpening): ForecastBalanceSheet {
  const totalAssets = o.cash + o.riderCash + o.fixedAssets + o.otherAssets;
  const totalLiabilities = o.merchants + o.vatPayable + o.loans + o.otherLiabilities;
  return {
    ...o,
    totalAssets,
    totalLiabilities,
    totalEquity: o.capital + o.retainedEarnings,
  };
}

function StatementGrid({
  kind,
  totals,
  opening,
  periodLabel,
}: {
  kind: 'bs' | 'cf';
  totals: ForecastPeriodTotals[];
  opening: ForecastOpening;
  periodLabel: (key: string) => string;
}) {
  const t = useTranslations('forecast');
  const open = openingSheet(opening);
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-body-sm">
        <thead>
          <tr>
            <th className={thStart}>{t('line')}</th>
            {kind === 'bs' && <th className={th}>{t('opening')}</th>}
            {totals.map((p) => (
              <th key={p.key} className={th}>
                {periodLabel(p.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {kind === 'bs'
            ? BS_ROWS.map((r) => (
                <tr key={r.key} className={`border-t border-line ${r.total ? 'bg-bg' : ''}`}>
                  <td className={`${tdName} ${r.total ? 'bg-bg font-bold' : ''}`}>
                    {t(`bs.${r.key}`)}
                  </td>
                  <td className={td}>
                    <Amount piastres={bsValue(open, r.key)} strong={r.total} />
                  </td>
                  {totals.map((p) => (
                    <td
                      key={p.key}
                      className={`${td} ${r.key === 'cash' && p.balanceSheet.cash < 0 ? 'bg-danger/10' : ''}`}
                    >
                      <Amount piastres={bsValue(p.balanceSheet, r.key)} strong={r.total} />
                    </td>
                  ))}
                </tr>
              ))
            : CF_ROWS.map((r) => (
                <tr key={r.key} className={`border-t border-line ${r.total ? 'bg-bg' : ''}`}>
                  <td className={`${tdName} ${r.total ? 'bg-bg font-bold' : ''}`}>
                    {t(`cf.${r.key}`)}
                  </td>
                  {totals.map((p) => (
                    <td
                      key={p.key}
                      className={`${td} ${r.key === 'cashEnd' && p.cashFlow.cashEnd < 0 ? 'bg-danger/10' : ''}`}
                    >
                      <Amount
                        piastres={CF_OUT.has(r.key) ? -p.cashFlow[r.key] : p.cashFlow[r.key]}
                        strong={r.total}
                      />
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}

/** The table of a tab for CSV and Excel: money in EGP, counts as they are. */
function tableOf(
  tab: Tab,
  result: ForecastResult,
  totals: ForecastPeriodTotals[],
  names: Names,
  t: ReturnType<typeof useTranslations>,
  opening: ForecastOpening,
  drivers: ForecastDriverRow[],
): { header: string[]; rows: ExportCell[][] } | null {
  const egp = (p: number) => p / 100;
  const label = (key: string) =>
    key.startsWith('m:') ? key.slice(2) : key === 'year' ? t('year') : key.toUpperCase();
  const header = [t('line'), ...totals.map((p) => label(p.key))];
  if (tab === 'drivers') {
    const months = result.months.map((m) => m.month);
    const set = driverMap(drivers);
    const unitValue = (key: string, v: number) => (unitOf(key) === 'money' ? egp(v) : v);
    return {
      header: [t('driver'), ...months],
      rows: driverGroups(drivers).flatMap((g) =>
        g.keys.map((key) => [
          names.driver(key),
          ...months.map((_, i) => unitValue(key, driverValue(set, months, result, key, i).value)),
        ]),
      ),
    };
  }
  if (tab === 'pl')
    return {
      header,
      rows: [
        [t('orders'), ...totals.map((p) => p.orders)],
        ...result.lines.map((l) => [
          names.line(l.key),
          ...totals.map((p) => egp(p.lines[l.key] ?? 0)),
        ]),
        [t('totalRevenue'), ...totals.map((p) => egp(p.revenue))],
        [t('totalCosts'), ...totals.map((p) => egp(p.expenses))],
        [t('profit'), ...totals.map((p) => egp(p.profit))],
      ],
    };
  if (tab === 'bs') {
    const open = openingSheet(opening);
    return {
      header: [t('line'), t('opening'), ...totals.map((p) => label(p.key))],
      rows: BS_ROWS.map((r) => [
        t(`bs.${r.key}`),
        egp(bsValue(open, r.key)),
        ...totals.map((p) => egp(bsValue(p.balanceSheet, r.key))),
      ]),
    };
  }
  if (tab === 'cf')
    return {
      header,
      rows: CF_ROWS.map((r) => [
        t(`cf.${r.key}`),
        ...totals.map((p) => egp(CF_OUT.has(r.key) ? -p.cashFlow[r.key] : p.cashFlow[r.key])),
      ]),
    };
  return null;
}

// ─── compare ──────────────────────────────────────────────────────────────────

function Compare({
  current,
  scenarios,
  names,
}: {
  current: string;
  scenarios: ForecastListRow[];
  names: Names;
}) {
  const t = useTranslations('forecast');
  const [chosen, setChosen] = useState<string[]>(() =>
    [current, ...scenarios.map((s) => s.id).filter((id) => id !== current)].slice(0, 3),
  );
  const [rows, setRows] = useState<CompareRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!chosen.length) {
      setRows([]);
      return;
    }
    void apiGetClient<CompareRow[]>(`/finance/forecasts/compare?ids=${chosen.join(',')}`).then(
      (r) => {
        if (!live) return;
        if (r.ok) setRows(r.data);
        else setError(errorText(t, r.error));
      },
    );
    return () => {
      live = false;
    };
  }, [chosen, t]);
  const toggle = (id: string) =>
    setChosen((list) =>
      list.includes(id) ? list.filter((x) => x !== id) : [...list, id].slice(-6),
    );
  const months = rows?.[0]?.months.map((m) => m.month) ?? [];
  return (
    <div className="space-y-3">
      <p className="text-body-sm text-text-muted">{t('compareIntro')}</p>
      <div className="flex flex-wrap gap-3 print:hidden">
        {scenarios.map((s) => (
          <label key={s.id} className="flex items-center gap-2 text-body-sm">
            <input type="checkbox" checked={chosen.includes(s.id)} onChange={() => toggle(s.id)} />
            <span className="ltr-iso">{s.number}</span> {s.name}
          </label>
        ))}
      </div>
      {error && <p className="text-body-sm text-danger">{error}</p>}
      {rows && rows.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-body-sm">
              <thead>
                <tr>
                  <th className={thStart}>{t('scenario')}</th>
                  <th className={th}>{t('yearRevenue')}</th>
                  <th className={th}>{t('yearProfit')}</th>
                  <th className={th}>{t('cashAtEnd')}</th>
                  <th className={th}>{t('lowestCash')}</th>
                  <th className={th}>{t('yearOrders')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className={tdName}>
                      <span className="ltr-iso">{r.number}</span> {r.name}
                    </td>
                    <td className={td}>
                      <Amount piastres={r.revenuePiastres} />
                    </td>
                    <td className={td}>
                      <Amount piastres={r.profitPiastres} strong />
                    </td>
                    <td className={td}>
                      <Amount piastres={r.cashEndPiastres} />
                    </td>
                    <td className={td}>
                      <Amount piastres={r.lowestCashPiastres} />
                    </td>
                    <td className={td}>{formatCount(r.orders)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(['profit', 'cashEnd'] as const).map((k) => (
            <section key={k} className="space-y-2">
              <h2 className="text-h3">{t(`compare.${k}`)}</h2>
              <div className="overflow-x-auto rounded-lg border border-line bg-surface">
                <table className="w-full text-body-sm">
                  <thead>
                    <tr>
                      <th className={thStart}>{t('scenario')}</th>
                      {months.map((m) => (
                        <th key={m} className={th}>
                          {names.monthName(m)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-t border-line">
                        <td className={tdName}>{r.name}</td>
                        {r.months.map((m) => (
                          <td key={m.month} className={td}>
                            <Amount piastres={m[k]} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

// ─── use as budget ────────────────────────────────────────────────────────────

function BudgetPanel({
  preview,
  names,
  busy,
  onCancel,
  onApply,
}: {
  preview: BudgetPreview;
  names: Names;
  busy: boolean;
  onCancel: () => void;
  onApply: (mode: 'replace' | 'skip') => void;
}) {
  const t = useTranslations('forecast');
  const locale = useLocale();
  const existing = preview.rows.filter((r) => r.existingPiastres !== null);
  const accountLabel = (r: BudgetPreview['rows'][number]) =>
    r.code ? `${r.code} ${(locale === 'ar' ? r.nameAr : r.nameEn) ?? ''}` : (r.accountKey ?? '');
  const accountsCount = new Set(preview.rows.map((r) => r.accountId ?? r.accountKey)).size;
  return (
    <section className="space-y-3 rounded-lg border border-primary/40 bg-surface p-4 print:hidden">
      <h2 className="text-h3">{t('budgetTitle')}</h2>
      <p className="text-body-sm">
        {t('budgetIntro', {
          from: names.monthName(preview.months[0]!),
          to: names.monthName(preview.months.at(-1)!),
          accounts: accountsCount,
        })}
      </p>
      {preview.negative > 0 && (
        <p className="text-body-sm text-text-muted">
          {t('budgetNegative', { count: preview.negative })}
        </p>
      )}
      {existing.length === 0 ? (
        <p className="text-body-sm text-text-muted">{t('budgetNoExisting')}</p>
      ) : (
        <>
          <p className="text-body-sm font-bold">
            {t('budgetExisting', { count: existing.length })}
          </p>
          <div className="max-h-72 overflow-auto rounded-lg border border-line">
            <table className="w-full text-body-sm">
              <thead>
                <tr>
                  <th className="px-2 py-2 text-start text-label uppercase text-text-muted">
                    {t('month')}
                  </th>
                  <th className="px-2 py-2 text-start text-label uppercase text-text-muted">
                    {t('account')}
                  </th>
                  <th className={th}>{t('budgetNow')}</th>
                  <th className={th}>{t('budgetForecast')}</th>
                </tr>
              </thead>
              <tbody>
                {existing.map((r) => (
                  <tr key={`${r.month}${r.accountId}`} className="border-t border-line">
                    <td className="px-2 py-1.5">{names.monthName(r.month)}</td>
                    <td className="px-2 py-1.5">{accountLabel(r)}</td>
                    <td className={td}>
                      <Amount piastres={r.existingPiastres ?? 0} />
                    </td>
                    <td className={td}>
                      <Amount piastres={r.amountPiastres} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={primary}
          disabled={busy}
          onClick={() => onApply('replace')}
        >
          {existing.length ? t('budgetReplace') : t('budgetWrite')}
        </button>
        {existing.length > 0 && (
          <button
            type="button"
            className={secondary}
            disabled={busy}
            onClick={() => onApply('skip')}
          >
            {t('budgetSkip')}
          </button>
        )}
        <button type="button" className={secondary} disabled={busy} onClick={onCancel}>
          {t('cancel')}
        </button>
      </div>
    </section>
  );
}
