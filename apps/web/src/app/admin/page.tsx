import { addDays, cairoDay } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { AutoRefresh } from '@/components/admin/AutoRefresh';
import { Stat } from '@/components/admin/Stat';
import { ColumnChart } from '@/components/charts/ColumnChart';
import { TargetBars } from '@/components/charts/TargetBars';
import { StatCard } from '@/components/StatCard';
import { StoreStatusChip } from '@/components/admin/StoreStatusChip';
import { type AdminStore, localized } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import type { Kpis, KpiTotals, LiveStore, SettingsList } from '@/lib/dashboard-types';
import { formatCount, formatEgp } from '@/lib/format';
import { fillDays, shortDay } from '@/lib/kpi-days';

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
  const days = fillDays(kpis.perDay, from, to);
  const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)}%`);
  const mins = (v: number | null) => (v === null ? '–' : t('minutes', { value: v }));
  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  const td = 'px-3 py-2';
  const field = 'mt-1 block h-10 rounded-md border border-line bg-surface px-2 text-body-sm';

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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h2">{t('title')}</h1>
          <p className="mt-1 text-body-sm text-text-muted">{t('kpis')}</p>
        </div>
        <form className="flex flex-wrap items-end gap-3" method="get">
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
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <StatCard icon="orders" label={t('orders')} value={formatCount(kpis.totals.orders)} />
        <StatCard
          icon="delivered"
          tone="delivered"
          label={t('delivered')}
          value={formatCount(kpis.totals.delivered)}
        />
        <StatCard
          icon="schedule"
          tone="delivered"
          label={t('onTime')}
          value={pct(kpis.totals.onTimeRate)}
        />
        <StatCard
          icon="courier"
          tone="in-progress"
          label={t('avgDelivery')}
          value={mins(kpis.totals.avgDeliveryMinutes)}
          hint={
            kpis.totals.medianDeliveryMinutes !== null
              ? t('medianDelivery', { value: kpis.totals.medianDeliveryMinutes })
              : undefined
          }
        />
        <StatCard
          icon="alert"
          tone="needs-action"
          label={t('late')}
          value={formatCount(kpis.totals.late)}
          alert={kpis.totals.late > 0}
        />
        <StatCard
          icon="returns"
          tone="returning"
          label={t('cancelledFailed')}
          value={formatCount(kpis.totals.cancelled + kpis.totals.failed)}
        />
        <StatCard
          icon="alert"
          tone="needs-action"
          label={t('missingUnits')}
          value={formatCount(kpis.totals.unitsMissing)}
          alert={kpis.totals.unitsMissing > 0}
        />
        <StatCard
          icon="new"
          tone="new"
          label={t('movedToStandard')}
          value={formatCount(kpis.totals.movedToStandard)}
        />
        <StatCard
          icon="cash"
          label={t('codCollected')}
          value={formatEgp(kpis.totals.codCollectedPiastres)}
        />
        <StatCard
          icon="products"
          label={t('deliveredValue')}
          value={formatEgp(kpis.totals.deliveredValuePiastres)}
        />
      </div>

      {kpis.totals.orders === 0 ? (
        <p className="mt-6 rounded-lg border border-line bg-surface p-5 text-body text-text-muted">
          {t('noData')}
        </p>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-5">
          <section className="rounded-lg border border-line bg-surface p-5 lg:col-span-3">
            <h2 className="text-h3">{t('perDay')}</h2>
            <p className="text-caption text-text-muted">{t('perDayHint')}</p>
            <div className="mt-4">
              <ColumnChart
                title={t('perDay')}
                valueLabel={t('orders')}
                columns={days.map((d) => ({
                  key: d.date,
                  label: shortDay(d.date),
                  value: d.orders,
                  detail: t('dayDetail', {
                    date: d.date,
                    orders: d.orders,
                    delivered: d.delivered,
                    onTime: d.onTime,
                  }),
                }))}
              />
            </div>
          </section>
          <section className="rounded-lg border border-line bg-surface p-5 lg:col-span-2">
            <h2 className="text-h3">{t('stageTimes')}</h2>
            <div className="mt-4">
              <TargetBars
                overLabel={t('overTarget')}
                bars={STAGES.map((stage) => {
                  const goal = target(`sla.${stage}_minutes`);
                  return {
                    key: stage,
                    label: stages(stage),
                    value: kpis.totals.stageAvgMinutes[stage],
                    target: goal,
                    valueText: mins(kpis.totals.stageAvgMinutes[stage]),
                    targetText:
                      goal !== null
                        ? t('target', { value: t('minutes', { value: goal }) })
                        : undefined,
                  };
                })}
              />
            </div>
          </section>
        </div>
      )}

      <section className="mt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-h3">{t('live')}</h2>
          <p className="text-caption text-text-muted">{t('liveHint')}</p>
        </div>
        <ul className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {stores.map((s) => {
            const now = live.stores.find((l) => l.darkStore.id === s.id);
            return (
              <li key={s.id} className="rounded-lg border border-line bg-surface p-5">
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

      {kpis.totals.orders > 0 && (
        <section className="mt-10">
          <h2 className="text-h3">{t('perStore')}</h2>
          <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
            <table className="w-full min-w-[760px] text-body-sm">
              {head(t('store'))}
              <tbody>
                {kpis.perStore.map((s) => row(localized(s.darkStore, locale), s, s.darkStore.id))}
              </tbody>
            </table>
          </div>

          <h2 className="mt-8 text-h3">{t('perMerchant')}</h2>
          <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
            <table className="w-full min-w-[760px] text-body-sm">
              {head(t('merchant'))}
              <tbody>{kpis.perMerchant.map((m) => row(m.merchant.name, m, m.merchant.id))}</tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
