import { canDo } from '@shiplynow/shared';
import {
  type ForecastDetailData,
  ForecastEditor,
  type ForecastListRow,
} from '@/components/finance/Forecast';
import { apiGet, getMyProfile } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

/** One forecast scenario: drivers, profit and loss, balance sheet, cash flow and compare. */
export default async function FinanceForecastDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, q] = await Promise.all([params, searchParams]);
  const [detail, scenarios, profile] = await Promise.all([
    apiGet<ForecastDetailData>(`/finance/forecasts/${encodeURIComponent(id)}`),
    apiGet<ForecastListRow[]>('/finance/forecasts'),
    getMyProfile(),
  ]);
  return (
    <ForecastEditor
      key={detail.forecast.id}
      detail={detail}
      scenarios={scenarios}
      initialTab={q.tab}
      canUse={canDo(profile, 'accounting', 'use')}
      canManage={canDo(profile, 'accounting', 'manage')}
    />
  );
}
