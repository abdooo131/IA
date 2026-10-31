import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ColumnChart } from '@/components/charts/ColumnChart';
import { DataTable } from '@/components/data/DataTable';
import { StatCard } from '@/components/StatCard';
import { apiGet } from '@/lib/api-server';
import { type CustomerList, type CustomersOverview, SEGMENTS } from '@/lib/customer-types';
import { formatCairoDateTime, formatEgp } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Filters = {
  q?: string;
  segment?: string;
  governorate?: string;
  merchantId?: string;
  due?: string;
  page?: string;
};

/** Every shopper across all merchants and our deliveries: who they are and how they buy. */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const filters = await searchParams;
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) query.set(k, v);
  const [list, o, t, days, locale] = await Promise.all([
    apiGet<CustomerList>(`/admin/customers?${query}`),
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
  const pageLink = (page: number) => {
    const q = new URLSearchParams(query);
    q.set('page', String(page));
    return `/admin/customers?${q}`;
  };
  const field = 'mt-1 block h-10 rounded-md border border-line bg-surface px-2 text-body-sm';
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>

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
            href={`/admin/customers?segment=${s.segment}`}
            className={`rounded-full border px-3 py-1 text-body-sm ${filters.segment === s.segment ? 'border-primary bg-primary text-on-primary' : 'border-line bg-surface'}`}
            title={t(`segmentHints.${s.segment}`, o.rules)}
          >
            {t(`segments.${s.segment}`)} · {s.customers}
          </Link>
        ))}
      </div>

      <form className="mt-4 flex flex-wrap items-end gap-3" method="get">
        <label className="text-caption">
          {t('search')}
          <input
            name="q"
            defaultValue={filters.q ?? ''}
            placeholder={t('searchHint')}
            className={`${field} w-64`}
          />
        </label>
        <label className="text-caption">
          {t('segment')}
          <select name="segment" defaultValue={filters.segment ?? ''} className={field}>
            <option value="">{t('allSegments')}</option>
            {SEGMENTS.map((s) => (
              <option key={s} value={s}>
                {t(`segments.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-caption">
          {t('governorate')}
          <select name="governorate" defaultValue={filters.governorate ?? ''} className={field}>
            <option value="">{t('allPlaces')}</option>
            {o.governorates
              .filter((g) => g.governorate)
              .map((g) => (
                <option key={g.governorate} value={g.governorate!}>
                  {g.governorate}
                </option>
              ))}
          </select>
        </label>
        <label className="flex h-10 items-center gap-2 text-body-sm">
          <input type="checkbox" name="due" value="1" defaultChecked={filters.due === '1'} />
          {t('dueOnly')}
        </label>
        <button className="h-10 rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary">
          {t('filter')}
        </button>
      </form>

      <div className="mt-4">
        <DataTable
          title={t('list')}
          empty={t('none')}
          headers={[
            t('customer'),
            t('orders'),
            t('spend'),
            t('merchants'),
            t('lastOrder'),
            t('segment'),
          ]}
          rows={list.customers.map((c) => [
            <Link key={c.id} href={`/admin/customers/${c.id}`} className="font-bold text-link">
              {c.name || c.phone || c.email}
              <span className="block text-caption font-normal text-text-muted">
                <span className="ltr-iso">{c.phone ?? c.email}</span>
                {c.governorate && ` · ${[c.city, c.governorate].filter(Boolean).join(', ')}`}
              </span>
            </Link>,
            c.orders,
            formatEgp(c.spendPiastres),
            c.merchants,
            c.lastOrderAt ? formatCairoDateTime(c.lastOrderAt, locale) : '–',
            c.expectedAt ? formatCairoDateTime(c.expectedAt, locale) : '–',
            t(`segments.${c.segment}`),
          ])}
        />
        <div className="mt-2 flex gap-3 text-body-sm">
          {list.page > 1 && (
            <Link href={pageLink(list.page - 1)} className="text-link">
              {t('previous')}
            </Link>
          )}
          {list.more && (
            <Link href={pageLink(list.page + 1)} className="text-link">
              {t('next')}
            </Link>
          )}
        </div>
      </div>

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
    </>
  );
}
