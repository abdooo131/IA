import { addDays, cairoDay } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { AutoRefresh } from '@/components/admin/AutoRefresh';
import { Stat } from '@/components/admin/Stat';
import { StoreStatusChip } from '@/components/admin/StoreStatusChip';
import { type AdminStore, localized } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import type { Kpis, KpiTotals, LiveStore, SettingsList } from '@/lib/dashboard-types';
import { formatCount, formatEgp } from '@/lib/format';

export const dynamic = 'force-dynamic';

const STAGES = ['accept', 'pick', 'pack', 'handover', 'ride'] as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; store?: string }>;
}) {
  const params = await searchParams;
  const today = cairoDay(new Date());
  const from = params.from && DAY.test(params.from) ? params.from : addDays(today, -6);
  const to = params.to && DAY.test(params.to) ? params.to : today;
  const query = new URLSearchParams({ from, to });
  if (params.store) query.set('darkStoreId', params.store);

  const [stores, live, kpis, settings, t, nav, stages, statuses, locale] = await Promise.all([
    apiGet<AdminStore[]>('/admin/dark-stores'),
    apiGet<{ stores: LiveStore[] }>('/admin/live'),
    apiGet<Kpis>(`/admin/kpis?${query}`),
    apiGet<SettingsList>('/admin/settings'),
    getTranslations('admin.overview'),
    getTranslations('admin.nav'),
    getTranslations('orders.stages'),
    getTranslations('orders.statuses'),
    getLocale(),
  ]);

  const target = (key: string) => {
    const s = settings.settings.find((x) => x.key === key);
    return s ? (s.global ?? s.default) : null;
  };
  const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)}%`);
  const mins = (v: number | null) => (v === null ? '–' : t('minutes', { value: v }));
  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  const td = 'px-3 py-2';
  const field = 'mt-1 block h-10 rounded-md border border-line bg-surface px-2 text-body-sm';
  const maxDay = Math.max(1, ...kpis.perDay.map((d) => d.orders));

  const row = (name: string, k: KpiTotals, key: string) => (
    <tr key={key} className="border-b border-line last:border-0">
      <td className={`${td} font-bold`}>{name}</td>
      <td className={`${td} ltr-iso text-end`}>{formatCount(k.orders)}</td>
      <td className={`${td} ltr-iso text-end`}>{formatCount(k.delivered)}</td>
      <td className={`${td} ltr-iso text-end`}>{pct(k.onTimeRate)}</td>
      <td className={`${td} ltr-iso text-end`}>{mins(k.avgDeliveryMinutes)}</td>
      <td className={`${td} ltr-iso text-end`}>{formatCount(k.late)}</td>
      <td className={`${td} ltr-iso text-end`}>{formatCount(k.cancelled + k.failed)}</td>
      <td className={`${td} ltr-iso text-end`}>{formatEgp(k.codCollectedPiastres)}</td>
    </tr>
  );
  const head = (first: string) => (
    <thead className="border-b border-line bg-surface-raised">
      <tr>
        <th className={th}>{first}</th>
        <th className={`${th} text-end`}>{t('orders')}</th>
        <th className={`${th} text-end`}>{t('delivered')}</th>
        <th className={`${th} text-end`}>{t('onTime')}</th>
        <th className={`${th} text-end`}>{t('avgDelivery')}</th>
        <th className={`${th} text-end`}>{t('late')}</th>
        <th className={`${th} text-end`}>{t('cancelledFailed')}</th>
        <th className={`${th} text-end`}>{t('codCollected')}</th>
      </tr>
    </thead>
  );

  return (
    <>
      <AutoRefresh seconds={20} />
      <h1 className="text-h2">{t('title')}</h1>

      <section className="mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-h3">{t('live')}</h2>
          <p className="text-caption text-text-muted">{t('liveHint')}</p>
        </div>
        <ul className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {stores.map((s) => {
            const now = live.stores.find((l) => l.darkStore.id === s.id);
            return (
              <li key={s.id} className="rounded-lg border border-line bg-surface p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-h3">{localized(s, locale)}</h3>
                    <p className="text-caption text-text-muted">
                      <span className="ltr-iso">{s.code}</span> ·{' '}
                      {locale === 'ar' ? s.addressAr : s.addressEn}
                    </p>
                  </div>
                </div>
                <div className="mt-3">
                  <StoreStatusChip
                    openNow={s.openNow}
                    atCapacity={s.atCapacity}
                    nextOpenAt={s.nextOpenAt}
                  />
                </div>
                {now && (
                  <>
                    <dl className="mt-4 grid grid-cols-3 gap-3">
                      <Stat label={t('active')} value={formatCount(now.active)} />
                      <Stat label={t('lateNow')} value={formatCount(now.late)} />
                      <Stat label={t('pastPromise')} value={formatCount(now.pastPromise)} />
                      <Stat
                        label={t('riders')}
                        value={t('ridersValue', { out: now.ridersOut, total: now.riders })}
                      />
                      <Stat label={t('openAlerts')} value={formatCount(now.openAlerts)} />
                      <Stat
                        label={t('ordersLastHour')}
                        value={formatCount(s.ordersLastHour)}
                        hint={t('ofCapacity', { capacity: s.capacityPerHour })}
                      />
                    </dl>
                    {now.active > 0 && (
                      <p className="mt-3 flex flex-wrap gap-1.5">
                        {Object.entries(now.byStatus).map(([status, count]) => (
                          <span
                            key={status}
                            className="rounded-pill border border-line px-2 py-0.5 text-caption"
                          >
                            {statuses(status)} <span className="ltr-iso font-bold">{count}</span>
                          </span>
                        ))}
                      </p>
                    )}
                  </>
                )}
                <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3">
                  <Stat label={t('unitsOnHand')} value={formatCount(s.unitsOnHand)} />
                  <Stat label={t('reserved')} value={formatCount(s.unitsReserved)} />
                  <Stat label={t('skusInStock')} value={formatCount(s.skusInStock)} />
                </dl>
                <div className="mt-4 flex flex-wrap gap-4 text-body-sm font-bold">
                  <Link className="text-link" href={`/admin/orders?store=${s.id}`}>
                    {t('queue')}
                  </Link>
                  <Link className="text-link" href={`/admin/stock?store=${s.id}`}>
                    {nav('stock')}
                  </Link>
                  <Link className="text-link" href={`/admin/zones?store=${s.id}`}>
                    {t('zones')} (<span className="ltr-iso">{s.zoneCount}</span>)
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-h3">{t('kpis')}</h2>
        <form className="mt-3 flex flex-wrap items-end gap-3" method="get">
          <label className="text-caption">
            {t('from')}
            <input type="date" name="from" defaultValue={from} dir="ltr" className={field} />
          </label>
          <label className="text-caption">
            {t('to')}
            <input type="date" name="to" defaultValue={to} dir="ltr" className={field} />
          </label>
          <label className="text-caption">
            {t('store')}
            <select name="store" defaultValue={params.store ?? ''} className={field}>
              <option value="">{t('allStores')}</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {localized(s, locale)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="h-10 rounded-md bg-selected-bg px-4 text-body-sm font-bold text-link"
          >
            {t('apply')}
          </button>
        </form>

        <dl className="mt-4 grid grid-cols-2 gap-4 rounded-lg border border-line bg-surface p-5 shadow-sm md:grid-cols-4">
          <Stat label={t('orders')} value={formatCount(kpis.totals.orders)} />
          <Stat label={t('delivered')} value={formatCount(kpis.totals.delivered)} />
          <Stat label={t('onTime')} value={pct(kpis.totals.onTimeRate)} />
          <Stat
            label={t('avgDelivery')}
            value={mins(kpis.totals.avgDeliveryMinutes)}
            hint={
              kpis.totals.medianDeliveryMinutes !== null
                ? t('medianDelivery', { value: kpis.totals.medianDeliveryMinutes })
                : undefined
            }
          />
          <Stat label={t('late')} value={formatCount(kpis.totals.late)} />
          <Stat
            label={t('cancelledFailed')}
            value={formatCount(kpis.totals.cancelled + kpis.totals.failed)}
          />
          <Stat label={t('missingUnits')} value={formatCount(kpis.totals.unitsMissing)} />
          <Stat label={t('movedToStandard')} value={formatCount(kpis.totals.movedToStandard)} />
          <Stat label={t('codCollected')} value={formatEgp(kpis.totals.codCollectedPiastres)} />
          <Stat label={t('deliveredValue')} value={formatEgp(kpis.totals.deliveredValuePiastres)} />
        </dl>

        {kpis.totals.orders === 0 ? (
          <p className="mt-6 text-body text-text-muted">{t('noData')}</p>
        ) : (
          <>
            <h3 className="mt-8 text-body font-bold">{t('stageTimes')}</h3>
            <ul className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-5">
              {STAGES.map((stage) => {
                const avg = kpis.totals.stageAvgMinutes[stage];
                const goal = target(`sla.${stage}_minutes`);
                const over = avg !== null && goal !== null && avg > goal;
                return (
                  <li
                    key={stage}
                    className={`rounded-lg border bg-surface p-3 ${over ? 'border-status-needs-action' : 'border-line'}`}
                  >
                    <p className="text-caption text-text-muted">{stages(stage)}</p>
                    <p className={`text-h3 ${over ? 'text-status-needs-action' : ''}`}>
                      <span className="ltr-iso">{mins(avg)}</span>
                    </p>
                    {goal !== null && (
                      <p className="text-caption text-text-muted">
                        {t('target', { value: t('minutes', { value: goal }) })}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>

            <h3 className="mt-8 text-body font-bold">{t('perDay')}</h3>
            <ul className="mt-2 space-y-1">
              {kpis.perDay.map((d) => (
                <li key={d.date} className="flex items-center gap-3 text-body-sm">
                  <span className="ltr-iso w-24 shrink-0">{d.date}</span>
                  <span className="relative h-5 flex-1 rounded-sm bg-surface-raised">
                    <span
                      className="absolute inset-y-0 start-0 rounded-sm bg-selected-bg"
                      style={{ width: `${(d.orders / maxDay) * 100}%` }}
                    />
                    <span
                      className="absolute inset-y-0 start-0 rounded-sm bg-primary"
                      style={{ width: `${(d.delivered / maxDay) * 100}%` }}
                    />
                  </span>
                  <span className="ltr-iso w-20 shrink-0 text-end">
                    {d.delivered} / {d.orders}
                  </span>
                </li>
              ))}
            </ul>

            <h3 className="mt-8 text-body font-bold">{t('perStore')}</h3>
            <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
              <table className="w-full min-w-[760px] text-body-sm">
                {head(t('store'))}
                <tbody>
                  {kpis.perStore.map((s) => row(localized(s.darkStore, locale), s, s.darkStore.id))}
                </tbody>
              </table>
            </div>

            <h3 className="mt-8 text-body font-bold">{t('perMerchant')}</h3>
            <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
              <table className="w-full min-w-[760px] text-body-sm">
                {head(t('merchant'))}
                <tbody>{kpis.perMerchant.map((m) => row(m.merchant.name, m, m.merchant.id))}</tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </>
  );
}
