import {
  cairoDay,
  LEDGER_LINE_FILTERS,
  LEDGER_LINE_GROUPS,
  type ListResult,
} from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Amount } from '@/components/finance/Amount';
import { LinesFilters } from '@/components/finance/reports/LinesFilters';
import { reportFilterOptions } from '@/components/finance/reports/DrillReportPage';
import { ListView } from '@/components/odoo/ListView';
import { apiGet, apiTry } from '@/lib/api-server';
import { isoToDayFirst } from '@/lib/day-first';
import type { BookAccount, FinanceOverview } from '@/lib/finance-types';
import type { ListRow, ListViewConfig } from '@/lib/list-view';

export const dynamic = 'force-dynamic';

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const DRILL_KEYS = [
  'account',
  'group',
  'set',
  'kind',
  'from',
  'to',
  'report',
  'store',
  'merchant',
  'rider',
];
const LIST_KEYS = ['q', 'f', 'g', 'sort', 'desc', 'page', 'size'];

/** Where the drill down came from (only our own report pages). */
const BACKS: Record<string, string> = {
  '/finance/profit-and-loss': 'reports.plTitle',
  '/finance/balance-sheet': 'reports.bsTitle',
  '/finance/trial': 'trial.title',
  '/finance/money-flow': 'period.cashTitle',
  '/finance/profit': 'profit.title',
};

/**
 * The ledger lines behind a report line (Accounting UX phase B): an account, a group of
 * wallets, all income and costs of a store, or the money of a kind of entry, as a list view
 * with filters, grouping and totals; each line opens its journal entry.
 */
export default async function ReportLinesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const drill = new URLSearchParams();
  for (const k of DRILL_KEYS) {
    const v = one(params[k]);
    if (v) drill.set(k, v);
  }
  const list = new URLSearchParams(drill);
  for (const k of LIST_KEYS) {
    const v = one(params[k]);
    if (v !== undefined) list.set(k, v);
  }
  const [data, accounts, options, overview, t, tf, ta, locale] = await Promise.all([
    apiGet<ListResult<ListRow> & { meta: { naturalDebit: boolean | null; truncated: boolean } }>(
      `/finance/ledger-lines?${list}`,
    ),
    apiGet<BookAccount[]>('/finance/accounts?all=true'),
    reportFilterOptions(),
    apiTry<FinanceOverview>('/finance/overview'),
    getTranslations('finance.drill'),
    getTranslations('finance'),
    getTranslations('apps'),
    getLocale(),
  ]);

  const account = accounts.find((a) => a.id === one(params.account));
  const group = one(params.group);
  const set = one(params.set);
  const kind = one(params.kind);
  const kindName = (k: string) => (tf.has(`kinds.${k}`) ? tf(`kinds.${k}`) : k);
  const what = account
    ? `${account.code} ${locale === 'ar' ? account.nameAr || account.nameEn : account.nameEn}`
    : group
      ? tf.has(`reports.groups.g${group}`)
        ? tf(`reports.groups.g${group}`)
        : group
      : set
        ? t(`sets.${set}`)
        : t('linesTitle');
  const title = kind ? `${what} · ${kindName(kind)}` : what;
  const from = one(params.from);
  const to = one(params.to) ?? cairoDay(new Date());
  const backParam = one(params.back) ?? '';
  const backPath = backParam.split('?')[0] ?? '';
  const back = backParam.startsWith('/finance/') && BACKS[backPath] ? backParam : null;
  const backLabel = back ? tf(BACKS[backPath]!) : null;

  const lineLabel = (k: string) => t(`lines.columns.${k}`);
  const config: ListViewConfig = {
    listId: 'finance_ledger_lines',
    endpoint: `/finance/ledger-lines?${drill}`,
    columns: [
      { key: 'number', label: lineLabel('number'), kind: 'ltr', sort: 'number', primary: true },
      { key: 'day', label: lineLabel('day'), kind: 'date', sort: 'day' },
      { key: 'kind', label: lineLabel('kind'), kind: 'text' },
      { key: 'memo', label: lineLabel('memo'), kind: 'text' },
      { key: 'account', label: lineLabel('account'), kind: 'text', optional: !!account },
      { key: 'store', label: lineLabel('store'), kind: 'ltr' },
      { key: 'merchant', label: lineLabel('merchant'), kind: 'text' },
      { key: 'rider', label: lineLabel('rider'), kind: 'text', optional: true },
      { key: 'orderNumber', label: lineLabel('orderNumber'), kind: 'ltr', optional: true },
      { key: 'debit', label: lineLabel('debit'), kind: 'money' },
      { key: 'credit', label: lineLabel('credit'), kind: 'money' },
      { key: 'net', label: lineLabel('net'), kind: 'money', sort: 'amount', optional: true },
    ],
    filters: Object.entries(LEDGER_LINE_FILTERS).map(([key, g]) => ({
      key,
      group: g,
      label: t(`lines.filters.${key}`),
    })),
    groupBys: LEDGER_LINE_GROUPS.map((key) => ({ key, label: t(`lines.groups.${key}`) })),
    valueLabels: {
      kind: Object.fromEntries(
        Object.keys(tf.raw('kinds') as Record<string, string>).map((k) => [k, kindName(k)]),
      ),
    },
    rowHref: '/finance/journal/{entryId}',
    navIdKey: 'entryId',
    navTrail: back && backLabel ? [{ label: backLabel, href: back }] : [],
    navLabel: title,
    defaultFilters: [],
    exportName: t('lines.exportName'),
  };

  const net = data.totals.net ?? 0;
  const figure = data.meta.naturalDebit === false ? 0 - net : net;
  const riders = (overview?.riders ?? []).map((r) => ({
    id: r.id,
    label: `${r.name} (${r.badgeCode})`,
  }));
  const kinds = Object.keys(tf.raw('kinds') as Record<string, string>)
    .map((k) => ({ id: k, label: kindName(k) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <>
      <nav aria-label={t('breadcrumbs')} className="text-body-sm">
        <ol className="flex flex-wrap items-center gap-1">
          <li>
            <Link href="/finance" className="text-link hover:underline">
              {ta('names.accounting')}
            </Link>
          </li>
          {back && (
            <>
              <li aria-hidden className="text-text-muted">
                /
              </li>
              <li>
                <Link href={back} className="text-link hover:underline">
                  {backLabel}
                </Link>
              </li>
            </>
          )}
          <li aria-hidden className="text-text-muted">
            /
          </li>
          <li aria-current="page" className="font-bold">
            {title}
          </li>
        </ol>
      </nav>
      <h1 className="mt-2 text-h2">{title}</h1>
      <p className="mt-1 text-body-sm text-text-muted">
        {from
          ? t('periodDays', { from: isoToDayFirst(from), to: isoToDayFirst(to) })
          : t('upTo', { day: isoToDayFirst(to) })}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-line bg-surface p-3">
          <p className="text-label uppercase text-text-muted">{t('lines.debit')}</p>
          <p className="mt-1 text-h3">
            <Amount piastres={data.totals.debit ?? 0} />
          </p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-3">
          <p className="text-label uppercase text-text-muted">{t('lines.credit')}</p>
          <p className="mt-1 text-h3">
            <Amount piastres={data.totals.credit ?? 0} />
          </p>
        </div>
        <div className="rounded-lg border border-line bg-selected-bg p-3">
          <p className="text-label uppercase text-text-muted">{t('lines.figure')}</p>
          <p className="mt-1 text-h3">
            <Amount piastres={figure} strong />
          </p>
          <p className="text-caption text-text-muted">
            {t('lines.figureHint', { count: data.total })}
          </p>
        </div>
      </div>
      {data.meta.truncated && (
        <p className="mt-2 text-body-sm text-danger">{t('lines.truncated')}</p>
      )}
      <LinesFilters
        stores={options.stores}
        merchants={options.merchants}
        riders={riders}
        kinds={kinds}
      />
      <ListView config={config} data={data} />
      <p className="mt-2 text-caption text-text-muted">{t('lines.openHint')}</p>
    </>
  );
}
