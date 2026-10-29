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
  page?: string;
};

/** Every shopper across all merchants and our deliveries: who they are and how they buy. */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<Filters> }) {
  const filters = await searchParams;
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) query.set(k, v);
  const [list, o, t, locale] = await Promise.all([
    apiGet<CustomerList>(`/admin/customers?${query}`),
    apiGet<CustomersOverview>('/admin/customers/overview'),
    getTranslations('customers'),
    getLocale(),
  ]);
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
      </div>
    </>
  );
}
