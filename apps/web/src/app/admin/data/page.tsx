import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ColumnChart } from '@/components/charts/ColumnChart';
import { DataTable } from '@/components/data/DataTable';
import { StatCard } from '@/components/StatCard';
import { apiGet } from '@/lib/api-server';
import type { MarketInsights } from '@/lib/data-types';
import { formatEgp } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** All merchants together: which categories sell and grow, where, and who leads. */
export default async function MarketDataPage() {
  const [m, t] = await Promise.all([
    apiGet<MarketInsights>('/admin/data/market'),
    getTranslations('data'),
  ]);
  const revenue90 = m.categories.reduce((s, c) => s + c.revenue90Piastres, 0);
  const egp = (p: number) => `${formatEgp(p)} EGP`;
  return (
    <>
      <h1 className="text-h2">{t('marketTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('marketIntro')}</p>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={t('merchants')} value={String(m.merchants.length)} />
        <StatCard label={t('categories')} value={String(m.categories.length)} />
        <StatCard label={t('revenue90')} value={formatEgp(revenue90)} />
        <StatCard
          label={t('orders90')}
          value={String(m.merchants.reduce((s, x) => s + x.orders90, 0))}
        />
      </div>
      {m.monthly.length > 0 && (
        <section className="mt-6 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-h3">{t('monthlySales')}</h2>
          <ColumnChart
            title={t('monthlySales')}
            valueLabel="EGP"
            columns={m.monthly.map((x) => ({
              key: x.month,
              label: x.month.slice(2),
              value: x.revenuePiastres / 100,
              detail: `${x.month}: ${egp(x.revenuePiastres)} · ${x.orders} ${t('ordersWord')}`,
            }))}
          />
        </section>
      )}
      <div className="mt-6 grid gap-4">
        <DataTable
          title={t('byCategory')}
          empty={t('noData')}
          headers={[
            t('category'),
            t('merchants'),
            t('products'),
            t('revenue90'),
            t('share'),
            t('growth'),
            t('avgItem'),
          ]}
          rows={m.categories.map((c) => [
            c.category,
            c.merchants,
            c.products,
            formatEgp(c.revenue90Piastres),
            `${c.sharePct}%`,
            c.growthPct === null ? '–' : `${c.growthPct > 0 ? '+' : ''}${c.growthPct}%`,
            formatEgp(c.averageLinePiastres),
          ])}
        />
        <DataTable
          title={t('byRegion')}
          empty={t('noRegions')}
          headers={[t('province'), t('orders90'), t('revenue90'), t('merchants')]}
          rows={m.regions.map((r) => [
            r.province,
            r.orders,
            formatEgp(r.revenuePiastres),
            r.merchants,
          ])}
        />
        <DataTable
          title={t('merchantsTitle')}
          empty={t('noData')}
          headers={[t('merchant'), t('orders90'), t('revenue90'), t('products'), t('mainCategory')]}
          rows={m.merchants.map((x) => [
            <Link key={x.id} href={`/admin/data/${x.id}`} className="font-bold text-link">
              {x.name}
            </Link>,
            x.orders90,
            formatEgp(x.revenue90Piastres),
            x.products,
            x.topCategory ?? '–',
          ])}
        />
      </div>
    </>
  );
}
