import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { StatCard } from '@/components/StatCard';
import { Amount } from '@/components/finance/Amount';
import { localized } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import type { CashPosition } from '@/lib/cash-control-types';
import { formatCairoDateTime, formatEgp } from '@/lib/format';
import { formatForeign } from '@/lib/foreign-money';

export const dynamic = 'force-dynamic';

const card = 'rounded-lg border border-line bg-surface p-4';
const th = 'py-2 text-start text-caption font-semibold text-text-muted';
const td = 'py-2 align-top';

/** A Cairo calendar day (YYYY-MM-DD) as a short date, day first. */
const formatDay = (day: string, locale: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });

/** Where the money is this morning: banks, boxes, riders, what we owe and bills due. */
export default async function CashPositionPage() {
  const [p, t, locale] = await Promise.all([
    apiGet<CashPosition>('/finance/cash-position'),
    getTranslations('cashControl.position'),
    getLocale(),
  ]);
  const hours = (from: string) => {
    const ms = Date.now() - new Date(from).getTime();
    return Math.max(0, Math.floor(ms / 3_600_000));
  };
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-h2">{t('title')}</h1>
          <p className="mt-1 max-w-3xl text-body-sm text-text-muted">
            {t('intro', { time: formatCairoDateTime(p.asOf, locale) })}
          </p>
        </div>
        <a
          href="/api/finance/cash-position/export.csv"
          className="h-10 rounded-md border border-line bg-surface px-4 py-2 text-body-sm font-bold text-link"
        >
          {t('export')}
        </a>
      </div>
      {p.scope === 'stores' && (
        <p className="mt-3 rounded-md border border-line bg-surface-raised px-3 py-2 text-body-sm">
          {t('scopeStores')}
        </p>
      )}

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon="wallet" label={t('money.bank')} value={formatEgp(p.money.bankPiastres)} />
        <StatCard icon="cash" label={t('money.boxes')} value={formatEgp(p.money.boxPiastres)} />
        <StatCard
          icon="courier"
          label={t('riders.title')}
          value={formatEgp(p.riders.totalPiastres)}
          tone={p.riders.overduePiastres > 0 ? 'needs-action' : 'primary'}
          alert={p.riders.overduePiastres > 0}
          hint={
            p.riders.overduePiastres > 0
              ? t('riders.overdueHint', { amount: formatEgp(p.riders.overduePiastres) })
              : undefined
          }
        />
        {p.netPiastres !== null && (
          <StatCard
            label={t('net.title')}
            value={formatEgp(p.netPiastres)}
            hint={t('net.hint')}
            tone={p.netPiastres < 0 ? 'needs-action' : 'delivered'}
          />
        )}
      </div>

      <section className={`mt-6 ${card}`}>
        <h2 className="text-h3">{t('money.title')}</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[420px] text-body-sm">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>{t('code')}</th>
                <th className={th}>{t('name')}</th>
                <th className={th}>{t('kind')}</th>
                <th className={`${th} text-end`}>{t('amount')}</th>
              </tr>
            </thead>
            <tbody>
              {p.money.rows.length === 0 && (
                <tr>
                  <td className={`${td} text-text-muted`} colSpan={4}>
                    {t('nothing')}
                  </td>
                </tr>
              )}
              {p.money.rows.map((a) => (
                <tr key={a.id} className="border-b border-line">
                  <td className={`${td} ltr-iso text-text-muted`}>{a.code}</td>
                  <td className={td}>
                    <Link href={`/finance/accounts/${a.id}`} className="text-link">
                      {localized(a, locale) || a.nameEn}
                    </Link>
                  </td>
                  <td className={`${td} text-text-muted`}>{t(`money.kinds.${a.kind}`)}</td>
                  <td className={`${td} text-end`}>
                    <Amount piastres={a.balancePiastres} />
                    {a.currency && a.currency !== 'EGP' && a.foreignBalanceCents != null && (
                      <span className="ltr-iso block text-caption text-text-muted">
                        {formatForeign(a.foreignBalanceCents, a.currency)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              <tr>
                <td className={`${td} font-bold`} colSpan={3}>
                  {t('total')}
                </td>
                <td className={`${td} text-end`}>
                  <Amount piastres={p.money.totalPiastres} strong />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className={`mt-6 ${card}`}>
        <h2 className="text-h3">{t('riders.title')}</h2>
        <p className="text-caption text-text-muted">{t('riders.intro', { warn: p.warnHours })}</p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-body-sm">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>{t('riders.rider')}</th>
                <th className={`${th} text-end`}>{t('riders.fresh', { hours: p.warnHours })}</th>
                <th className={`${th} text-end`}>{t('riders.aging')}</th>
                <th className={`${th} text-end`}>{t('riders.overdue')}</th>
                <th className={`${th} text-end`}>{t('amount')}</th>
              </tr>
            </thead>
            <tbody>
              {p.riders.rows.length === 0 && (
                <tr>
                  <td className={`${td} text-text-muted`} colSpan={5}>
                    {t('riders.none')}
                  </td>
                </tr>
              )}
              {p.riders.rows.map((r) => (
                <tr key={r.riderId} className="border-b border-line">
                  <td className={td}>
                    <span className="font-semibold">{r.name}</span>{' '}
                    <span className="ltr-iso text-text-muted">{r.badgeCode}</span>
                    <span className="block text-caption text-text-muted">
                      {localized(r.store, locale)} ·{' '}
                      {t('riders.since', { hours: hours(r.heldSince) })}
                    </span>
                  </td>
                  <td className={`${td} text-end`}>
                    <Amount piastres={r.freshPiastres} />
                  </td>
                  <td className={`${td} text-end`}>
                    <Amount piastres={r.agingPiastres} />
                  </td>
                  <td
                    className={`${td} text-end ${r.overduePiastres > 0 ? 'font-bold text-status-needs-action' : ''}`}
                  >
                    <span className="ltr-iso">{formatEgp(r.overduePiastres)}</span>
                  </td>
                  <td className={`${td} text-end`}>
                    <Amount piastres={r.cashPiastres} strong />
                  </td>
                </tr>
              ))}
              <tr>
                <td className={`${td} font-bold`}>{t('total')}</td>
                <td className={`${td} text-end`}>
                  <Amount piastres={p.riders.freshPiastres} />
                </td>
                <td className={`${td} text-end`}>
                  <Amount piastres={p.riders.agingPiastres} />
                </td>
                <td className={`${td} text-end`}>
                  <Amount piastres={p.riders.overduePiastres} />
                </td>
                <td className={`${td} text-end`}>
                  <Amount piastres={p.riders.totalPiastres} strong />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {p.merchants && (
        <section className={`mt-6 ${card}`}>
          <h2 className="text-h3">{t('merchants.title')}</h2>
          {p.merchants.owingUsPiastres > 0 && (
            <p className="text-caption text-text-muted">
              {t('merchants.owingUs', { amount: formatEgp(p.merchants.owingUsPiastres) })}
            </p>
          )}
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[520px] text-body-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className={th}>{t('merchants.merchant')}</th>
                  <th className={th}>{t('merchants.next')}</th>
                  <th className={`${th} text-end`}>{t('merchants.draft')}</th>
                  <th className={`${th} text-end`}>{t('merchants.owed')}</th>
                </tr>
              </thead>
              <tbody>
                {p.merchants.rows.length === 0 && (
                  <tr>
                    <td className={`${td} text-text-muted`} colSpan={4}>
                      {t('merchants.none')}
                    </td>
                  </tr>
                )}
                {p.merchants.rows.map((m) => (
                  <tr key={m.id} className="border-b border-line">
                    <td className={td}>
                      <Link href={`/finance/merchants/${m.id}`} className="text-link">
                        {m.name}
                      </Link>
                    </td>
                    <td className={td}>
                      <span className="ltr-iso">{formatDay(m.nextPayoutDay, locale)}</span>
                      <span className="block text-caption text-text-muted">
                        {t(`merchants.schedules.${m.schedule}`)}
                      </span>
                    </td>
                    <td className={`${td} text-end`}>
                      {m.draftPiastres > 0 ? <Amount piastres={m.draftPiastres} /> : '—'}
                    </td>
                    <td className={`${td} text-end`}>
                      <Amount piastres={m.owedPiastres} strong />
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className={`${td} font-bold`} colSpan={3}>
                    {t('total')}
                  </td>
                  <td className={`${td} text-end`}>
                    <Amount piastres={p.merchants.totalPiastres} strong />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {p.bills && (
        <section className={`mt-6 ${card}`}>
          <h2 className="text-h3">{t('bills.title')}</h2>
          <ul className="mt-2 divide-y divide-line text-body-sm">
            {p.bills.rows.length === 0 && (
              <li className="py-2 text-text-muted">{t('bills.none')}</li>
            )}
            {p.bills.rows.map((b) => (
              <li key={b.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  <Link href="/finance/bills" className="ltr-iso font-bold text-link">
                    BILL-{String(b.number).padStart(6, '0')}
                  </Link>{' '}
                  {b.supplier} · {b.reference}
                  <span
                    className={`block text-caption ${b.overdue ? 'font-bold text-status-needs-action' : 'text-text-muted'}`}
                  >
                    {b.overdue ? t('bills.overdue') : t('bills.due')}{' '}
                    <span className="ltr-iso">{formatDay(b.dueDate, locale)}</span>
                  </span>
                </span>
                <Amount piastres={b.leftPiastres} strong />
              </li>
            ))}
          </ul>
          <p className="mt-2 flex justify-between border-t border-line pt-2 text-body-sm font-bold">
            <span>{t('total')}</span>
            <Amount piastres={p.bills.totalPiastres} strong />
          </p>
        </section>
      )}

      {p.netPiastres !== null && p.merchants && p.bills && (
        <section className={`mt-6 ${card}`}>
          <h2 className="text-h3">{t('net.title')}</h2>
          <table className="mt-2 w-full text-body-sm">
            <tbody>
              {(
                [
                  ['money.title', p.money.totalPiastres],
                  ['riders.title', p.riders.totalPiastres],
                  ['merchants.title', 0 - p.merchants.totalPiastres],
                  ['bills.title', 0 - p.bills.totalPiastres],
                ] as const
              ).map(([label, amount]) => (
                <tr key={label} className="border-b border-line">
                  <td className={td}>{t(label)}</td>
                  <td className={`${td} text-end`}>
                    <Amount piastres={amount} />
                  </td>
                </tr>
              ))}
              <tr>
                <td className={`${td} font-bold`}>{t('net.title')}</td>
                <td className={`${td} text-end`}>
                  <Amount piastres={p.netPiastres} strong />
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-1 text-caption text-text-muted">{t('net.hint')}</p>
        </section>
      )}
    </>
  );
}
