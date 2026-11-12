import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ColumnChart } from '@/components/charts/ColumnChart';
import { DataTable } from '@/components/data/DataTable';
import { OrderHistoryNote } from '@/components/data/OrderHistoryNote';
import { appListConfig, appListData } from '@/components/odoo/app-lists';
import { ListView } from '@/components/odoo/ListView';
import { StatCard } from '@/components/StatCard';
import { apiGet } from '@/lib/api-server';
import { type CustomersOverview, SEGMENTS } from '@/lib/customer-types';
import { formatEgp } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Params = Record<string, string | string[] | undefined>;

/**
 * The address before the list view (?segment=, ?merchantId=, ?due=1, ?governorate=) as the
 * list state, so old links open the right customers; null when there is nothing to turn.
 */
function legacyAddress(params: Params): string | null {
  const one = (k: string) => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  if (one('f') !== undefined || one('v') !== undefined) return null;
  const segment = one('segment');
  const merchantId = one('merchantId');
  const due = one('due') === '1' || one('due') === 'true';
  if (!segment && !merchantId && !due && one('governorate') === undefined) return null;
  const filters = [
    ...(segment && (SEGMENTS as readonly string[]).includes(segment) ? [segment] : []),
    ...(due ? ['due_to_reorder'] : []),
  ];
  const query = new URLSearchParams({ f: filters.join(',') });
  if (merchantId && /^[A-Za-z0-9_-]{1,64}$/.test(merchantId))
    query.set('v', `merchant:${merchantId}`);
  const q = one('q');
  if (q) query.set('q', q);
  return `/admin/customers?${query}`;
}

/**
 * Every shopper across all merchants and our deliveries: who they are and how they buy. The
 * people themselves are a list view (UX phase C step 3: search by name, phone or email;
 * segments, cash risk, due to order again, the merchant they bought from and their district;
 * grouping and order and spend totals); each opens their profile, which is audited.
 */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const legacy = legacyAddress(params);
  if (legacy) redirect(legacy);
  const [config, data, o, t, days, locale] = await Promise.all([
    appListConfig('customers/customers'),
    appListData('customers/customers', params),
    apiGet<CustomersOverview>('/admin/customers/overview'),
    getTranslations('customers'),
    getTranslations('weekdays'),
    getLocale(),
  ]);
  const byDay = Array.from({ length: 7 }, (_, d) =>
    o.timing.filter((x) => x.dow === d).reduce((sum, x) => sum + x.orders, 0),
  );
  const byHour = Array.from({ length: 24 }, (_, h) =>
    o.timing.filter((x) => x.hour === h).reduce((sum, x) => sum + x.orders, 0),
  );
  const hour = (h: number) => `${String(h).padStart(2, '0')}:00`;

  const field = 'mt-1 block h-10 rounded-md border border-line bg-surface px-2 text-body-sm';
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <OrderHistoryNote shops={o.orderHistory} fromShopifyTotals={o.fromShopifyTotals} />

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label={t('customers')}
          value={String(o.customers)}
          hint={t('contactMix', { phone: o.withPhone, email: o.withEmail })}
        />
        <StatCard
          label={t('repeat')}
          value={`${o.repeatPct}%`}
          hint={t('averageOrders', { orders: o.averageOrders })}
        />
        <StatCard
          label={t('multiMerchant')}
          value={`${o.multiMerchantPct}%`}
          hint={t('multiHint')}
        />
        <StatCard label={t('averageSpend')} value={formatEgp(o.averageSpendPiastres)} />
        <StatCard
          label={t('forecast')}
          value={formatEgp(o.forecastPiastres)}
          hint={t('forecastHint')}
        />
        <StatCard
          label={t('dueTitle')}
          value={String(o.dueToReorder)}
          hint={t('dueHint', { pct: o.rules.latePct })}
        />
        <StatCard
          label={t('consent')}
          value={`${o.emailSubscribers} · ${o.smsSubscribers}`}
          hint={t('consentHint')}
        />
        <Link
          href="/admin/customers/places"
          className="flex flex-col justify-center rounded-lg border border-line bg-surface p-4 text-body-sm font-bold text-link"
        >
          {t('placesLink')}
          <span className="mt-1 text-caption font-normal text-text-muted">{t('placesHint')}</span>
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {o.segments.map((s) => (
          <Link
            key={s.segment}
            href={`/admin/customers?f=${s.segment}`}
            className="rounded-full border border-line bg-surface px-3 py-1 text-body-sm hover:border-primary"
            title={t(`segmentHints.${s.segment}`, o.rules)}
          >
            {t(`segments.${s.segment}`)} · {s.customers}
          </Link>
        ))}
      </div>

      <form
        className="mt-3 flex flex-wrap items-end gap-3"
        method="get"
        action="/api/admin/customers/export"
      >
        <label className="text-caption">
          {t('exportSegment')}
          <select name="segment" defaultValue="" className={field}>
            <option value="">{t('allSegments')}</option>
            {SEGMENTS.map((s) => (
              <option key={s} value={s}>
                {t(`segments.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex h-10 items-center gap-2 text-body-sm">
          <input type="checkbox" name="marketing" value="1" />
          {t('exportMarketing')}
        </label>
        <button className="h-10 rounded-md border border-line bg-surface px-4 text-body-sm font-bold">
          {t('exportCsv')}
        </button>
        <span className="text-caption text-text-muted">{t('exportHint')}</span>
      </form>

      <h2 className="mt-6 text-h3">{t('list')}</h2>
      <ListView config={config} data={data} />

      <details className="mt-6 rounded-lg border border-line bg-surface">
        <summary className="cursor-pointer px-4 py-3 text-body-sm font-bold text-link">
          {t('moreInsights')}
        </summary>
        <div className="p-4 pt-0">
          {o.newByMonth.length > 0 && (
            <section className="mt-6 rounded-lg border border-line bg-surface p-4">
              <h2 className="text-h3">{t('newByMonth')}</h2>
              <ColumnChart
                title={t('newByMonth')}
                valueLabel={t('customers')}
                columns={o.newByMonth.map((m) => ({
                  key: m.month,
                  label: m.month.slice(2),
                  value: m.customers,
                  detail: `${m.month}: ${m.customers}`,
                }))}
              />
            </section>
          )}

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <DataTable
              title={t('byGovernorate')}
              empty={t('none')}
              headers={[t('governorate'), t('customers'), t('spend')]}
              rows={o.governorates.map((g) => [
                g.governorate ?? t('unknownPlace'),
                g.customers,
                formatEgp(g.spendPiastres),
              ])}
            />
            <DataTable
              title={t('shared')}
              empty={t('noShared')}
              headers={[t('merchantPair'), t('customers')]}
              rows={o.sharedShoppers.map((s) => [`${s.a.name} + ${s.b.name}`, s.customers])}
            />
            <DataTable
              title={t('pairs')}
              empty={t('noPairs')}
              headers={[t('categoryPair'), t('customers'), t('lift')]}
              rows={o.categoryPairs.map((p) => [`${p.a} + ${p.b}`, p.customers, `×${p.lift}`])}
            />
            <DataTable
              title={t('risky')}
              empty={t('noRisky')}
              headers={[t('customer'), t('attempts'), t('failed'), t('refused'), t('riskPct')]}
              rows={o.riskyCustomers.map((c) => [
                <Link key={c.id} href={`/admin/customers/${c.id}`} className="font-bold text-link">
                  {c.name || c.phone}
                </Link>,
                c.attempts,
                c.failed,
                c.refused,
                `${c.pct}%`,
              ])}
            />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <section className="rounded-lg border border-line bg-surface p-4">
              <h2 className="text-h3">{t('byDayAll')}</h2>
              <ColumnChart
                title={t('byDayAll')}
                valueLabel={t('orders')}
                height={140}
                columns={byDay.map((v, d) => ({
                  key: String(d),
                  label: locale === 'ar' ? days(String(d)) : days(String(d)).slice(0, 3),
                  value: v,
                  detail: `${days(String(d))}: ${v}`,
                }))}
              />
            </section>
            <section className="rounded-lg border border-line bg-surface p-4">
              <h2 className="text-h3">{t('byHourAll')}</h2>
              <ColumnChart
                title={t('byHourAll')}
                valueLabel={t('orders')}
                height={140}
                columns={byHour.map((v, h) => ({
                  key: String(h),
                  label: h % 3 === 0 ? String(h) : '',
                  value: v,
                  detail: `${hour(h)}: ${v}`,
                }))}
              />
            </section>
          </div>
          <div className="mt-4">
            <DataTable
              title={t('storePeaks')}
              empty={t('none')}
              headers={[t('store'), t('orders90'), t('peakHours')]}
              rows={o.storePeaks.map((s) => [
                locale === 'ar' ? s.nameAr : s.nameEn,
                s.orders,
                s.hours.map((h) => `${hour(h.hour)} (${h.orders})`).join(' · '),
              ])}
            />
          </div>
        </div>
      </details>
    </>
  );
}
