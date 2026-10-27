import { addDays, cairoDay } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ColumnChart } from '@/components/charts/ColumnChart';
import { CancelShipmentButton } from '@/components/merchant/CancelShipmentButton';
import {
  OnboardingChecklist,
  type OnboardingSteps,
} from '@/components/merchant/OnboardingChecklist';
import { ShipmentStatusChip } from '@/components/shipment/ShipmentStatusChip';
import { StatCard } from '@/components/StatCard';
import { WalletCard } from '@/components/WalletCard';
import { localized } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import type { KpiTotals } from '@/lib/dashboard-types';
import { formatCount, formatEgp } from '@/lib/format';
import { type DayCount, fillDays, shortDay } from '@/lib/kpi-days';
import type { MerchantShipment } from '@/lib/merchant-types';
import { title } from '@/lib/store-types';

export const dynamic = 'force-dynamic';

export default async function ShipmentsPage() {
  const today = cairoDay(new Date());
  const from = addDays(today, -13);
  const [shipments, kpis, wallet, t, th, locale, steps] = await Promise.all([
    apiGet<MerchantShipment[]>('/merchant/manifests'),
    apiGet<{ totals: KpiTotals; perDay: DayCount[] }>(
      `/merchant/orders/kpis?from=${from}&to=${today}`,
    ),
    apiGet<{ owedPiastres: number }>('/merchant/finance'),
    getTranslations('merchant.shipments'),
    getTranslations('merchant.home'),
    getLocale(),
    apiGet<OnboardingSteps>('/merchant/onboarding'),
  ]);
  const k = kpis.totals;
  const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)}%`);
  return (
    <>
      <h1 className="text-h2">{th('title')}</h1>
      <p className="mt-1 text-body-sm text-text-muted">{th('period')}</p>
      <OnboardingChecklist steps={steps} />
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard icon="orders" label={th('orders')} value={formatCount(k.orders)} />
        <StatCard
          icon="delivered"
          tone="delivered"
          label={th('delivered')}
          value={formatCount(k.delivered)}
        />
        <StatCard icon="schedule" tone="delivered" label={th('onTime')} value={pct(k.onTimeRate)} />
        <StatCard
          icon="returns"
          tone="returning"
          label={th('cancelledFailed')}
          value={formatCount(k.cancelled + k.failed)}
        />
        <StatCard
          icon="delivered"
          tone="delivered"
          label={th('rating')}
          value={k.avgRating === null ? '–' : `${k.avgRating} ★`}
          hint={th('ratingCount', { count: k.ratings })}
        />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-line bg-surface p-5 lg:col-span-2">
          <h2 className="text-h3">{th('perDay')}</h2>
          <div className="mt-4">
            <ColumnChart
              title={th('perDay')}
              valueLabel={th('orders')}
              columns={fillDays(kpis.perDay, from, today).map((d) => ({
                key: d.date,
                label: shortDay(d.date),
                value: d.orders,
                detail: th('dayDetail', { date: d.date, orders: d.orders, delivered: d.delivered }),
              }))}
            />
          </div>
        </section>
        <div className="space-y-4">
          <WalletCard
            icon="wallet"
            label={wallet.owedPiastres < 0 ? th('owes') : th('owed')}
            value={th('amount', { amount: formatEgp(Math.abs(wallet.owedPiastres)) })}
          />
          <WalletCard
            icon="cash"
            label={th('codCollected')}
            value={th('amount', { amount: formatEgp(k.codCollectedPiastres) })}
          />
          <Link
            href="/merchant/new"
            className="flex h-12 items-center justify-center rounded-md bg-primary px-4 font-bold text-on-primary"
          >
            {th('newShipment')}
          </Link>
        </div>
      </div>

      <h2 className="mt-10 text-h3">{t('title')}</h2>
      {shipments.length === 0 ? (
        <p className="mt-4 text-body text-text-muted">{t('empty')}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {shipments.map((s) => {
            const expected = s.lines.reduce((sum, l) => sum + l.expectedQty, 0);
            const received = s.lines.reduce((sum, l) => sum + l.receivedQty, 0);
            return (
              <li key={s.id} className="rounded-lg border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    href={`/merchant/shipments/${s.id}`}
                    className="ltr-iso text-h3 text-link underline"
                  >
                    {s.reference}
                  </Link>
                  <ShipmentStatusChip status={s.status} />
                </div>
                <p className="text-body-sm text-text-muted">
                  {localized(s.darkStore, locale)} · {t('units', { received, expected })}
                </p>
                <ul className="mt-3 divide-y divide-line border-t border-line">
                  {s.lines.map((l) => {
                    const diff = l.receivedQty - l.expectedQty;
                    const started = s.status !== 'expected';
                    return (
                      <li key={l.sku} className="py-2 text-body-sm">
                        <p>
                          <span className="ltr-iso font-bold">{l.sku}</span> {title(l, locale)}
                        </p>
                        {l.expectedQty === 0 && (
                          <p className="text-caption text-text-muted">{t('extra')}</p>
                        )}
                        <p className="mt-0.5 flex flex-wrap gap-x-3 text-text-muted">
                          <span>
                            {t('expected')}{' '}
                            <span className="ltr-iso font-bold text-text">{l.expectedQty}</span>
                          </span>
                          <span>
                            {t('received')}{' '}
                            <span className="ltr-iso font-bold text-text">{l.receivedQty}</span>
                          </span>
                          {started && (
                            <span className="font-bold text-text">
                              {diff === 0
                                ? t('complete')
                                : diff < 0
                                  ? t('missing', { count: -diff })
                                  : t('over', { count: diff })}
                            </span>
                          )}
                        </p>
                      </li>
                    );
                  })}
                </ul>
                {s.status === 'expected' && <CancelShipmentButton id={s.id} />}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
