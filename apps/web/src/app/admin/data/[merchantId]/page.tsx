import { getLocale, getTranslations } from 'next-intl/server';
import { ColumnChart } from '@/components/charts/ColumnChart';
import { DataTable } from '@/components/data/DataTable';
import { RefreshDataButton } from '@/components/data/RefreshDataButton';
import { StatCard } from '@/components/StatCard';
import { BackLink } from '@/components/store/BackLink';
import { apiGet } from '@/lib/api-server';
import type { MerchantInsights, ProductInsight } from '@/lib/data-types';
import { formatCairoDateTime, formatEgp } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** One merchant's store as Shopify knows it, and what it means. */
export default async function MerchantDataPage({
  params,
}: {
  params: Promise<{ merchantId: string }>;
}) {
  const { merchantId } = await params;
  const [d, t, locale] = await Promise.all([
    apiGet<MerchantInsights>(`/admin/data/merchants/${merchantId}`),
    getTranslations('data'),
    getLocale(),
  ]);
  const when = (v: string | null) => (v ? formatCairoDateTime(v, locale) : '–');
  const product = (p: ProductInsight) => (
    <span className="flex items-center gap-2">
      {p.imageUrl && (
        // Shopify's CDN image: a tiny thumbnail, not worth the image optimiser.
        <img
          src={p.imageUrl}
          alt=""
          width={32}
          height={32}
          className="h-8 w-8 rounded object-cover"
        />
      )}
      <span>
        {p.title}
        <span className="block text-caption text-text-muted">{p.category ?? '–'}</span>
      </span>
    </span>
  );
  const profile = d.shop?.profile?.shop;
  return (
    <>
      <BackLink href="/admin/data" />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-h2">{d.merchant.name}</h1>
          <p className="text-body-sm text-text-muted">
            {d.shop ? (
              <>
                <span className="ltr-iso">{d.shop.domain}</span>
                {profile?.plan?.displayName && ` · ${profile.plan.displayName}`}
                {profile?.createdAt && ` · ${t('since', { date: when(profile.createdAt) })}`}
                {' · '}
                {t('lastSync', { date: when(d.shop.dataSyncedAt) })}
              </>
            ) : (
              t('noShop')
            )}
          </p>
        </div>
        {d.shop && <RefreshDataButton merchantId={d.merchant.id} />}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label={t('products')}
          value={String(d.catalogue.products)}
          hint={t('statusMix', d.catalogue)}
        />
        <StatCard
          label={t('stockOwn')}
          value={String(d.stock.ownWarehouses)}
          hint={t('stockOurs', { units: d.stock.inOurStores, warehouses: d.stock.warehouses })}
        />
        <StatCard
          label={t('revenueAll')}
          value={formatEgp(d.sales.revenuePiastres)}
          hint={t('ordersUnits', { orders: d.sales.orders, units: d.sales.units })}
        />
        <StatCard
          label={t('avgOrder')}
          value={formatEgp(d.sales.averageOrderPiastres)}
          hint={t('discountRate', { pct: (d.sales.discountRateBp / 100).toFixed(1) })}
        />
        <StatCard
          label={t('revenue30')}
          value={formatEgp(d.sales.revenue30Piastres)}
          hint={t('ordersShort', { orders: d.sales.orders30 })}
        />
        <StatCard label={t('stockValue')} value={formatEgp(d.stock.valuePiastres)} />
        <StatCard
          label={t('abc')}
          value={`${d.abc.A} · ${d.abc.B} · ${d.abc.C}`}
          hint={t('abcHint')}
        />
        <StatCard
          label={t('history')}
          value={when(d.sales.firstOrderAt)}
          hint={t('lastOrder', { date: when(d.sales.lastOrderAt) })}
        />
      </div>

      {d.monthly.length > 0 && (
        <section className="mt-6 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-h3">{t('monthlySales')}</h2>
          <ColumnChart
            title={t('monthlySales')}
            valueLabel="EGP"
            columns={d.monthly.map((x) => ({
              key: x.month,
              label: x.month.slice(2),
              value: x.revenuePiastres / 100,
              detail: `${x.month}: ${formatEgp(x.revenuePiastres)} EGP · ${x.orders} ${t('ordersWord')}`,
            }))}
          />
        </section>
      )}

      <div className="mt-6 grid gap-4">
        <DataTable
          title={t('topProducts')}
          empty={t('noData')}
          headers={[t('product'), t('units90'), t('revenue90'), t('stock'), t('cover')]}
          rows={d.topProducts.map((p) => [
            product(p),
            p.units90,
            formatEgp(p.revenue90),
            p.stock,
            p.coverDays ?? '–',
          ])}
        />
        <DataTable
          title={t('runningOut')}
          empty={t('noneRunningOut')}
          headers={[t('product'), t('stock'), t('cover'), t('units90')]}
          rows={d.runningOut.map((p) => [product(p), p.stock, p.coverDays ?? '–', p.units90])}
        />
        <DataTable
          title={t('deadStock')}
          empty={t('noDeadStock')}
          headers={[t('product'), t('stock'), t('lastSold')]}
          rows={d.deadStock.map((p) => [product(p), p.stock, when(p.lastSold)])}
        />
        <DataTable
          title={t('byCategory')}
          empty={t('noData')}
          headers={[t('category'), t('products'), t('units90'), t('revenue90')]}
          rows={d.categories.map((c) => [
            c.category,
            c.products,
            c.units90,
            formatEgp(c.revenue90Piastres),
          ])}
        />
        <DataTable
          title={t('byRegion')}
          empty={t('noRegions')}
          headers={[t('province'), t('orders90'), t('revenue90')]}
          rows={d.regions.map((r) => [r.province, r.orders, formatEgp(r.revenuePiastres)])}
        />
        <DataTable
          title={t('channels')}
          empty={t('noData')}
          headers={[t('channel'), t('orders'), t('revenueAll')]}
          rows={d.channels.map((c) => [c.source, c.orders, formatEgp(c.revenuePiastres)])}
        />
        <DataTable
          title={t('crossSell', {
            customers: d.crossSell.customers,
            elsewhere: d.crossSell.alsoBuyElsewhere,
          })}
          empty={t('noCrossSell')}
          headers={[t('category'), t('customersWord'), t('spendElsewhere'), t('merchants')]}
          rows={d.crossSell.gaps.map((g) => [
            g.category,
            g.customers,
            formatEgp(g.spendPiastres),
            g.merchants,
          ])}
        />
        {d.shop && (
          <DataTable
            title={t('syncs')}
            empty={t('noSyncs')}
            headers={[t('what'), t('state'), t('rows'), t('started')]}
            rows={d.shop.syncs.map((s) => [
              t.has(`kinds.${s.kind}`) ? t(`kinds.${s.kind}`) : s.kind,
              `${t.has(`states.${s.status}`) ? t(`states.${s.status}`) : s.status}${s.limited ? ` (${t('limited')})` : ''}${s.error ? ` · ${s.error}` : ''}`,
              s.objectCount,
              when(s.startedAt),
            ])}
          />
        )}
      </div>
    </>
  );
}
