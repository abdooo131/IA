import { cairoDay } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  type MerchantProfitDetail,
  ProfitBreakdown,
  WhatIfCalculator,
} from '@/components/finance/MerchantProfit';
import { BackLink } from '@/components/store/BackLink';
import { apiGet } from '@/lib/api-server';
import { formatEgp } from '@/lib/format';

export const dynamic = 'force-dynamic';
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** One merchant's month: fees, costs, margin, where the shares came from, and what if. */
export default async function MerchantProfitDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ merchantId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const [{ merchantId }, q] = await Promise.all([params, searchParams]);
  const month = q.month && MONTH.test(q.month) ? q.month : cairoDay(new Date()).slice(0, 7);
  const [detail, t, locale] = await Promise.all([
    apiGet<MerchantProfitDetail>(`/finance/merchant-profit/${merchantId}?month=${month}`),
    getTranslations('finance.merchantProfit'),
    getLocale(),
  ]);
  return (
    <>
      <BackLink href={`/finance/merchant-profit?month=${month}`} />
      <h1 className="mt-2 text-h2">
        {detail.merchant.name} <span className="ltr-iso text-text-muted">{month}</span>
      </h1>
      <form className="mt-3 flex flex-wrap items-end gap-3" method="get">
        <label className="text-caption">
          {t('month')}
          <input
            type="month"
            name="month"
            defaultValue={month}
            dir="ltr"
            className="mt-1 block h-10 rounded-md border border-line bg-surface px-2 text-body-sm"
          />
        </label>
        <button
          type="submit"
          className="h-10 rounded-md bg-selected-bg px-4 text-body-sm font-bold text-link"
        >
          {t('show')}
        </button>
      </form>
      <p className="mt-3 text-body-sm">
        {t('volume', {
          orders: detail.deliveredOrders,
          products: formatEgp(detail.productsPiastres),
          cash: formatEgp(detail.codCashPiastres),
        })}
      </p>
      <div className="mt-4">
        <ProfitBreakdown row={detail} />
      </div>
      {detail.stores.length > 0 && (
        <section className="mt-4 rounded-lg border border-line bg-surface p-4 text-body-sm">
          <h2 className="mb-2 text-h3">{t('stores')}</h2>
          <ul className="space-y-1">
            {detail.stores.map((s) => (
              <li key={s.darkStoreId}>
                <span className="font-bold">
                  {s.store ? (locale === 'ar' ? s.store.nameAr : s.store.nameEn) : s.darkStoreId}
                </span>
                :{' '}
                {t('storeLine', {
                  orders: s.orders,
                  storeOrders: s.storeOrders,
                  units: s.unitDays,
                  storeUnits: s.storeUnitDays,
                })}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="mt-4">
        <WhatIfCalculator detail={detail} />
      </div>
    </>
  );
}
