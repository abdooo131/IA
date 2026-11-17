import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { ForecastList, type ForecastListRow } from '@/components/finance/Forecast';
import { apiGet, getMyProfile } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

/** Forecast scenarios of the next 12 months, and a new one from the books or a copy. */
export default async function FinanceForecastPage() {
  const [rows, profile, t] = await Promise.all([
    apiGet<ForecastListRow[]>('/finance/forecasts'),
    getMyProfile(),
    getTranslations('forecast'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <ForecastList rows={rows} canUse={canDo(profile, 'accounting', 'use')} />
    </>
  );
}
