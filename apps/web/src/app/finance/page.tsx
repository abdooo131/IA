import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { StatCard } from '@/components/StatCard';
import { WalletCard } from '@/components/WalletCard';
import { localized } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import type { FinanceOverview } from '@/lib/finance-types';
import { formatEgp } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function FinanceOverviewPage() {
  const [data, t, tf, locale] = await Promise.all([
    apiGet<FinanceOverview>('/finance/overview'),
    getTranslations('finance.overview'),
    getTranslations('finance'),
    getLocale(),
  ]);
  const card = 'rounded-lg border border-line bg-surface p-5';
  return (
    <>
      <h1 className="text-h2">{tf('title')}</h1>

      {(data.totals.pendingHandovers > 0 || data.totals.draftPayouts > 0) && (
        <section className="mt-6 rounded-lg border border-status-needs-action bg-surface p-4">
          <h2 className="text-body font-bold">{t('attention')}</h2>
          <ul className="mt-2 space-y-1 text-body-sm">
            {data.totals.pendingHandovers > 0 && (
              <li>
                <Link href="/finance/cash" className="font-bold text-link">
                  {t('pendingHandovers')}:{' '}
                  <span className="ltr-iso">{data.totals.pendingHandovers}</span>
                </Link>
              </li>
            )}
            {data.totals.draftPayouts > 0 && (
              <li>
                <Link href="/finance/payouts" className="font-bold text-link">
                  {t('draftPayouts')}: <span className="ltr-iso">{data.totals.draftPayouts}</span> ·{' '}
                  <span className="ltr-iso">{formatEgp(data.totals.draftPayoutsPiastres)}</span>{' '}
                  {tf('egp')}
                </Link>
              </li>
            )}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-h3">{t('wallets')}</h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <WalletCard
            icon="payout"
            label={t('owedToMerchants')}
            value={formatEgp(data.totals.owedToMerchantsPiastres)}
          />
          <WalletCard
            icon="invoice"
            label={t('owedByMerchants')}
            value={formatEgp(data.totals.owedByMerchantsPiastres)}
          />
          <WalletCard
            icon="courier"
            label={t('cashWithRiders')}
            value={formatEgp(data.totals.cashWithRidersPiastres)}
          />
          <WalletCard
            icon="store"
            label={t('cashInStores')}
            value={formatEgp(data.totals.cashInStoresPiastres)}
          />
          <WalletCard
            icon="cash"
            label={t('bonusOwed')}
            value={formatEgp(data.totals.riderBonusOwedPiastres)}
          />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-h3">{t('company')}</h2>
        <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          <StatCard icon="wallet" label={t('bank')} value={formatEgp(data.company.bankPiastres)} />
          <StatCard
            icon="analytics"
            tone="delivered"
            label={t('revenue')}
            value={formatEgp(data.company.revenuePiastres)}
          />
          <StatCard
            icon="invoice"
            label={t('vat')}
            value={formatEgp(data.company.vatPayablePiastres)}
          />
          <StatCard
            icon="courier"
            tone="in-progress"
            label={t('bonusCost')}
            value={formatEgp(data.company.riderBonusExpensePiastres)}
          />
          <StatCard
            icon="alert"
            tone="needs-action"
            label={t('cashDifference')}
            value={formatEgp(data.company.cashDifferencePiastres)}
            alert={data.company.cashDifferencePiastres !== 0}
          />
        </div>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <div className={card}>
          <h2 className="text-body font-bold">
            <Link href="/finance/cash" className="text-link">
              {tf('cash.stores')}
            </Link>
          </h2>
          <ul className="mt-2 divide-y divide-line text-body-sm">
            {data.stores.map((s) => (
              <li key={s.id} className="flex justify-between py-2">
                <span>{localized(s, locale)}</span>
                <span className="ltr-iso font-bold">{formatEgp(s.cashPiastres)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className={card}>
          <h2 className="text-body font-bold">
            <Link href="/finance/merchants" className="text-link">
              {tf('merchants.title')}
            </Link>
          </h2>
          <ul className="mt-2 divide-y divide-line text-body-sm">
            {data.merchants.slice(0, 8).map((m) => (
              <li key={m.id} className="flex justify-between py-2">
                <Link href={`/finance/merchants/${m.id}`} className="text-link">
                  {m.name}
                </Link>
                <span className={`ltr-iso font-bold ${m.owedPiastres < 0 ? 'text-danger' : ''}`}>
                  {formatEgp(m.owedPiastres)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
