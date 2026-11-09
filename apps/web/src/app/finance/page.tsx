import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Sparkline } from '@/components/charts/Sparkline';
import { Icon, type IconName } from '@/components/Icon';
import { canDo } from '@shiplynow/shared';
import { apiGet, getMyProfile } from '@/lib/api-server';
import { isoToDayFirst } from '@/lib/day-first';
import { formatEgp } from '@/lib/format';

export const dynamic = 'force-dynamic';

interface Wait {
  key: string;
  count: number;
  amountPiastres?: number;
  href: string;
}
interface Card {
  key: string;
  kind: string;
  name: { en: string; ar: string } | null;
  code: string | null;
  balancePiastres: number;
  spark: number[];
  waits: Wait[];
  actions: { key: string; href: string }[];
  parts?: { id: string; name: { en: string; ar: string }; code: string; balancePiastres: number }[];
}
interface Dashboard {
  today: string;
  scope: 'all' | 'stores';
  todayItems: Wait[];
  activities: { id: string; label: string; href: string; dueOn: string; note: string }[];
  monthEnd: {
    month: string;
    done: number;
    total: number;
    readyToClose: boolean;
    closed: boolean;
  } | null;
  cards: Card[];
}

const ICONS: Record<string, IconName> = {
  bank: 'wallet',
  cash_box: 'cash',
  store_boxes: 'store',
  payouts: 'payout',
  bills: 'invoice',
  invoices: 'invoice',
  riders: 'courier',
  approvals: 'alert',
};

/**
 * The Accounting dashboard, Odoo style: a Today strip of what needs someone now, then one card
 * per bank account and cash box, the store boxes, merchant payouts, supplier bills, merchant
 * invoices, rider withdrawals and approvals, each with its balance, 30 days and what waits.
 */
export default async function FinanceDashboardPage() {
  const [data, t, tf, locale, me] = await Promise.all([
    apiGet<Dashboard>('/finance/dashboard'),
    getTranslations('finance.dashboard'),
    getTranslations('finance'),
    getLocale(),
    getMyProfile(),
  ]);
  // The guided runs and the quick expense form (Accounting UX phase B).
  const quick = [
    ...(me && canDo(me, 'accounting', 'use')
      ? [{ key: 'recordExpense', href: '/finance/expenses/new', icon: 'invoice' as IconName }]
      : []),
    { key: 'payMerchants', href: '/finance/payouts/run', icon: 'payout' as IconName },
    { key: 'matchBank', href: '/finance/bank', icon: 'wallet' as IconName },
    {
      key: 'closeMonth',
      href: data.monthEnd
        ? `/finance/month-end/run?month=${data.monthEnd.month}`
        : '/finance/month-end/run',
      icon: 'alert' as IconName,
    },
  ];
  const name = (c: Card) =>
    c.name ? (locale === 'ar' ? c.name.ar || c.name.en : c.name.en) : t(`cards.${c.kind}`);
  const waitText = (w: Wait) => t(`waits.${w.key}`, { count: w.count });
  const busy = data.todayItems.filter((i) => i.count > 0);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-h2">{t('title')}</h1>
          <p className="mt-1 text-body-sm text-text-muted">
            {t('intro')} · <span className="ltr-iso">{isoToDayFirst(data.today)}</span>
          </p>
        </div>
        <Link href="/finance/reports" className="text-body-sm font-bold text-link">
          {t('allReports')}
        </Link>
      </div>

      <nav aria-label={t('quickLabel')} className="mt-4">
        <ul className="flex flex-wrap gap-2">
          {quick.map((q) => (
            <li key={q.key}>
              <Link
                href={q.href}
                className="inline-flex h-11 items-center gap-2 rounded-md border border-line bg-surface px-4 text-body-sm font-bold hover:border-primary hover:bg-surface-raised"
              >
                <Icon name={q.icon} size={20} className="text-link" />
                {t(`quick.${q.key}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <section
        aria-labelledby="today"
        className="mt-5 rounded-lg border border-line bg-surface p-4"
      >
        <h2 id="today" className="text-h3">
          {t('today')}
        </h2>
        {busy.length === 0 ? (
          <p className="mt-1 text-body-sm text-text-muted">{t('allClear')}</p>
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {busy.map((i) => (
              <li key={i.key}>
                <Link
                  href={i.href}
                  className="flex min-h-14 items-center gap-3 rounded-md border border-line px-3 py-2 hover:border-primary hover:bg-surface-raised"
                >
                  <span className="ltr-iso flex h-9 min-w-9 items-center justify-center rounded-pill bg-selected-bg px-2 text-body font-bold text-link">
                    {i.count}
                  </span>
                  <span className="min-w-0 text-body-sm">
                    <span className="block font-semibold">
                      {t(`todayItems.${i.key}`, { count: i.count })}
                    </span>
                    {i.amountPiastres ? (
                      <span className="ltr-iso text-caption text-text-muted">
                        {formatEgp(i.amountPiastres)} {tf('egp')}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {data.monthEnd && (
            <Link
              href={`/finance/month-end/run?month=${data.monthEnd.month}`}
              className="flex items-center justify-between gap-3 rounded-md bg-surface-raised px-3 py-2 text-body-sm"
            >
              <span>
                <span className="font-semibold">
                  {t('monthEnd', { month: data.monthEnd.month })}
                </span>
                <span className="block text-caption text-text-muted">
                  {data.monthEnd.closed
                    ? t('monthClosed')
                    : data.monthEnd.readyToClose
                      ? t('monthReady')
                      : t('monthLeft', { left: data.monthEnd.total - data.monthEnd.done })}
                </span>
              </span>
              <span className="ltr-iso font-bold">
                {data.monthEnd.done}/{data.monthEnd.total}
              </span>
            </Link>
          )}
          <div id="activities" className="rounded-md bg-surface-raised px-3 py-2 text-body-sm">
            <p className="font-semibold">{t('myActivities')}</p>
            {data.activities.length === 0 ? (
              <p className="text-caption text-text-muted">{t('noActivities')}</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {data.activities.map((a) => (
                  <li key={a.id} className="flex gap-2">
                    <span
                      aria-hidden
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.dueOn < data.today ? 'bg-danger' : 'bg-status-needs-action'}`}
                    />
                    <Link href={a.href} className="min-w-0 truncate">
                      <span className="ltr-iso font-bold text-link">{a.label}</span> · {a.note}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <ul
        className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        aria-label={t('journals')}
      >
        {data.cards.map((c) => (
          <li
            key={c.key}
            className="flex flex-col rounded-lg border border-line bg-surface p-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-selected-bg text-link">
                  <Icon name={ICONS[c.kind] ?? 'wallet'} size={20} />
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-body font-bold">{name(c)}</h2>
                  <p className="text-caption text-text-muted">
                    {c.code ? <span className="ltr-iso">{c.code} · </span> : null}
                    {t(`balanceOf.${c.kind}`)}
                  </p>
                </div>
              </div>
              <p
                className={`ltr-iso shrink-0 text-h3 ${c.balancePiastres < 0 ? 'text-danger' : ''}`}
              >
                {formatEgp(c.balancePiastres)}
              </p>
            </div>
            <div className="mt-3">
              <Sparkline values={c.spark} label={t('sparkLabel', { name: name(c) })} />
              <p className="mt-0.5 text-caption text-text-muted">{t(`sparkOf.${c.kind}`)}</p>
            </div>
            {c.parts && c.parts.length > 0 && (
              <ul className="mt-2 divide-y divide-line text-body-sm">
                {c.parts.slice(0, 5).map((p) => (
                  <li key={p.id} className="flex justify-between gap-2 py-1">
                    <span className="truncate">{locale === 'ar' ? p.name.ar : p.name.en}</span>
                    <span className="ltr-iso font-semibold">{formatEgp(p.balancePiastres)}</span>
                  </li>
                ))}
              </ul>
            )}
            <ul className="mt-3 space-y-1 text-body-sm">
              {c.waits.map((w) => (
                <li key={w.key}>
                  <Link
                    href={w.href}
                    className={`flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-surface-raised ${w.count > 0 ? 'font-semibold text-link' : 'text-text-muted'}`}
                  >
                    <span>{waitText(w)}</span>
                    {w.amountPiastres ? (
                      <span className="ltr-iso text-caption">{formatEgp(w.amountPiastres)}</span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-auto flex flex-wrap gap-2 pt-3">
              {c.actions.map((a, i) => (
                <Link
                  key={a.key}
                  href={a.href}
                  className={`flex h-10 items-center rounded-md px-3 text-body-sm font-bold ${
                    i === 0
                      ? 'bg-primary text-on-primary'
                      : 'border border-line bg-surface text-text hover:bg-surface-raised'
                  }`}
                >
                  {t(`actions.${a.key}`)}
                </Link>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
