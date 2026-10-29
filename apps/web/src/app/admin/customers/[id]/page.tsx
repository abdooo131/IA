import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ColumnChart } from '@/components/charts/ColumnChart';
import { MergeCustomerForm } from '@/components/customers/MergeCustomerForm';
import { DataTable } from '@/components/data/DataTable';
import { StatCard } from '@/components/StatCard';
import { BackLink } from '@/components/store/BackLink';
import { apiGet } from '@/lib/api-server';
import type { CustomerProfile } from '@/lib/customer-types';
import { formatCairoDateTime, formatEgp } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** One person across every merchant: who, where, what they buy, from whom, when and how. */
export default async function CustomerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [p, t, days, locale] = await Promise.all([
    apiGet<CustomerProfile>(`/admin/customers/${id}`),
    getTranslations('customers'),
    getTranslations('weekdays'),
    getLocale(),
  ]);
  const when = (v: string | null) => (v ? formatCairoDateTime(v, locale) : '–');
  const c = p.customer;
  const byDay = Array.from({ length: 7 }, (_, d) =>
    p.timing.filter((x) => x.dow === d).reduce((s, x) => s + x.orders, 0),
  );
  const byHour = Array.from({ length: 24 }, (_, h) =>
    p.timing.filter((x) => x.hour === h).reduce((s, x) => s + x.orders, 0),
  );
  const payment = (m: string) => (t.has(`payments.${m}`) ? t(`payments.${m}`) : m);
  return (
    <>
      <BackLink href="/admin/customers" />
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-h2">{c.name || c.phone || c.email}</h1>
          <p className="text-body-sm text-text-muted">
            {c.phone && <span className="ltr-iso">{c.phone}</span>}
            {c.phone && c.email && ' · '}
            {c.email && <span className="ltr-iso">{c.email}</span>}
          </p>
          <p className="text-body-sm text-text-muted">
            {[c.address, c.city, c.governorate].filter(Boolean).join(', ') || t('unknownPlace')}
          </p>
          {p.district && (
            <p className="text-body-sm text-text-muted">
              {t('districtIs', { name: locale === 'ar' ? p.district.nameAr : p.district.nameEn })}
            </p>
          )}
          {p.aliases.length > 0 && (
            <p className="text-caption text-text-muted">
              {t('alsoKnown')}{' '}
              <span className="ltr-iso">{p.aliases.map((a) => a.value).join(' · ')}</span>
            </p>
          )}
        </div>
        <span className="rounded-full border border-line bg-surface px-3 py-1 text-body-sm font-bold">
          {t(`segments.${p.segment}`)}
        </span>
      </div>
      <p className="mt-2 text-caption text-text-muted">{t('privacy')}</p>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label={t('spend')}
          value={formatEgp(p.totals.spendPiastres)}
          hint={t('ordersUnits', { orders: p.totals.orders, units: p.totals.units })}
        />
        <StatCard
          label={t('averageOrder')}
          value={formatEgp(p.totals.averageOrderPiastres)}
          hint={
            p.totals.everyDays === null ? undefined : t('everyDays', { days: p.totals.everyDays })
          }
        />
        <StatCard
          label={t('merchants')}
          value={String(p.totals.merchants)}
          hint={t('cancelledCount', { count: p.totals.cancelled })}
        />
        <StatCard
          label={t('firstOrder')}
          value={when(p.totals.firstOrderAt)}
          hint={t('lastOrderOn', { date: when(p.totals.lastOrderAt) })}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label={t('spend30')}
          value={formatEgp(p.value.spend30Piastres)}
          hint={t('spend90', { amount: formatEgp(p.value.spend90Piastres) })}
        />
        <StatCard label={t('spend365')} value={formatEgp(p.value.spend365Piastres)} />
        <StatCard
          label={t('forecast')}
          value={formatEgp(p.value.forecastPiastres)}
          hint={
            p.value.expectedAt
              ? t(p.value.due ? 'overdue' : 'nextOrder', { date: when(p.value.expectedAt) })
              : undefined
          }
        />
        <StatCard
          label={t('priceLevel')}
          value={p.value.priceTier ? t(`tiers.${p.value.priceTier}`) : '–'}
          hint={
            p.value.priceIndex === null ? undefined : t('priceIndex', { index: p.value.priceIndex })
          }
        />
      </div>

      <section
        className={`mt-4 rounded-lg border border-s-4 bg-surface p-4 ${p.risk.level === 'high' ? 'border-danger' : p.risk.level === 'medium' ? 'border-status-needs-action' : p.risk.level === 'low' ? 'border-status-delivered' : 'border-line'}`}
      >
        <h2 className="text-h3">{t('riskTitle')}</h2>
        <p className="mt-1 text-body-sm">
          <strong>{t(`riskLevels.${p.risk.level}`)}</strong>
          {' · '}
          {t('riskLine', {
            attempts: p.risk.attempts,
            failed: p.risk.failed,
            refused: p.risk.refused,
            pct: p.risk.pct,
          })}
          {' · '}
          {t('riskMore', { noAnswer: p.risk.noAnswer, short: p.risk.cashShort })}
        </p>
      </section>

      {p.value.monthly.length > 0 && (
        <section className="mt-4 rounded-lg border border-line bg-surface p-4">
          <h2 className="text-h3">{t('monthlySpend')}</h2>
          <ColumnChart
            title={t('monthlySpend')}
            valueLabel="EGP"
            height={140}
            columns={p.value.monthly.map((m) => ({
              key: m.month,
              label: m.month.slice(2),
              value: m.spendPiastres / 100,
              detail: `${m.month}: ${formatEgp(m.spendPiastres)} EGP · ${m.orders}`,
            }))}
          />
        </section>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-line bg-surface p-4">
          <h2 className="text-h3">{t('byDay')}</h2>
          <ColumnChart
            title={t('byDay')}
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
          <h2 className="text-h3">{t('byHour')}</h2>
          <ColumnChart
            title={t('byHour')}
            valueLabel={t('orders')}
            height={140}
            columns={byHour.map((v, h) => ({
              key: String(h),
              label: h % 3 === 0 ? String(h) : '',
              value: v,
              detail: `${String(h).padStart(2, '0')}:00: ${v}`,
            }))}
          />
        </section>
      </div>

      <div className="mt-6 grid gap-4">
        <DataTable
          title={t('fromMerchants')}
          empty={t('none')}
          headers={[t('merchant'), t('orders'), t('spend'), t('lastOrder')]}
          rows={p.merchants.map((m) => [
            <Link key={m.id} href={`/admin/data/${m.id}`} className="font-bold text-link">
              {m.name}
            </Link>,
            m.orders,
            formatEgp(m.spendPiastres),
            when(m.lastOrderAt),
          ])}
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <DataTable
            title={t('categories')}
            empty={t('noLines')}
            headers={[t('category'), t('units'), t('spend')]}
            rows={p.categories.map((x) => [x.category, x.units, formatEgp(x.spendPiastres)])}
          />
          <DataTable
            title={t('paymentsTitle')}
            empty={t('none')}
            headers={[t('payment'), t('orders')]}
            rows={p.payments.map((x) => [payment(x.method), x.orders])}
          />
        </div>
        <DataTable
          title={t('products')}
          empty={t('noLines')}
          headers={[t('product'), t('units'), t('spend'), t('lastBought')]}
          rows={p.products.map((x) => [
            <span key={x.title + x.merchant} className="flex items-center gap-2">
              {x.imageUrl && (
                // Shopify's CDN image: a tiny thumbnail, not worth the image optimiser.
                <img
                  src={x.imageUrl}
                  alt=""
                  width={32}
                  height={32}
                  className="h-8 w-8 rounded object-cover"
                />
              )}
              <span>
                {x.title}
                <span className="block text-caption text-text-muted">{x.merchant}</span>
              </span>
            </span>,
            x.units,
            formatEgp(x.spendPiastres),
            when(x.lastAt),
          ])}
        />
        <DataTable
          title={t('withUs')}
          empty={t('none')}
          headers={[
            t('deliveries'),
            t('delivered'),
            t('failed'),
            t('cancelled'),
            t('cod'),
            t('stars'),
          ]}
          rows={
            p.deliveries.orders
              ? [
                  [
                    p.deliveries.orders,
                    p.deliveries.delivered,
                    p.deliveries.failed,
                    p.deliveries.cancelled,
                    formatEgp(p.deliveries.codPiastres),
                    p.deliveries.averageStars ?? '–',
                  ],
                ]
              : []
          }
        />
        <DataTable
          title={t('shopRecords')}
          empty={t('noShopRecords')}
          headers={[
            t('merchant'),
            t('nameThere'),
            t('orders'),
            t('spend'),
            t('emailMarketing'),
            t('smsMarketing'),
            t('since'),
          ]}
          rows={p.shopRecords.map((s) => [
            s.merchant,
            s.name || '–',
            s.ordersCount,
            formatEgp(s.amountSpentPiastres),
            s.emailMarketing ? payment(s.emailMarketing) : '–',
            s.smsMarketing ? payment(s.smsMarketing) : '–',
            when(s.since),
          ])}
        />
        <DataTable
          title={t('household')}
          empty={t('noHousehold')}
          headers={[t('customer'), t('phone')]}
          rows={p.household.map((h) => [
            <Link key={h.id} href={`/admin/customers/${h.id}`} className="font-bold text-link">
              {h.name || '–'}
            </Link>,
            <span key={`${h.id}-p`} className="ltr-iso">
              {h.phone ?? '–'}
            </span>,
          ])}
        />
        <MergeCustomerForm customerId={c.id} />
        <DataTable
          title={t('recent')}
          empty={t('none')}
          headers={[t('order'), t('date'), t('value'), t('units'), t('status')]}
          rows={p.recentOrders.map((o) => [
            o.source === 'shiply' ? (
              <Link
                key={o.recordId}
                href={`/admin/orders/${o.recordId}`}
                className="font-bold text-link"
              >
                {o.ref}
                <span className="block text-caption font-normal text-text-muted">
                  {o.merchant} · {t('sourceShiply')}
                </span>
              </Link>
            ) : (
              <span key={o.recordId}>
                {o.ref}
                <span className="block text-caption text-text-muted">
                  {o.merchant} · {t('sourceShopify')}
                </span>
              </span>
            ),
            when(o.at),
            formatEgp(o.valuePiastres),
            o.units,
            o.status ? (t.has(`statuses.${o.status}`) ? t(`statuses.${o.status}`) : o.status) : '–',
          ])}
        />
      </div>
    </>
  );
}
