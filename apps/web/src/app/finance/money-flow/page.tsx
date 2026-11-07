import { addDays, cairoDay, isCalendarDay } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { CashFlowView } from '@/components/finance/PeriodReports';
import { apiGet } from '@/lib/api-server';
import type { CashFlowReport, CashForecast } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

export default async function FinanceCashFlowPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const q = await searchParams;
  const today = cairoDay(new Date());
  const from = q.from && isCalendarDay(q.from) ? q.from : addDays(today, -29);
  const to = q.to && isCalendarDay(q.to) ? q.to : today;
  const [flow, forecast, t] = await Promise.all([
    apiGet<CashFlowReport>(`/finance/cash-flow?${new URLSearchParams({ from, to })}`),
    apiGet<CashForecast>('/finance/cash-forecast'),
    getTranslations('finance.period'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('cashTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('cashIntro')}</p>
      <CashFlowView flow={flow} forecast={forecast} from={from} to={to} />
    </>
  );
}
