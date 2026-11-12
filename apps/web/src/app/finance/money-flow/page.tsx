import { cairoDay } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { CashFlowView } from '@/components/finance/PeriodReports';
import { reportFilterOptions } from '@/components/finance/reports/DrillReportPage';
import { ReportFilterBar } from '@/components/finance/reports/ReportFilterBar';
import { apiGet } from '@/lib/api-server';
import type { CashFlowReport, CashForecast } from '@/lib/finance-types';
import { readReportState } from '@/lib/report-view';

export const dynamic = 'force-dynamic';

export default async function FinanceCashFlowPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const today = cairoDay(new Date());
  const state = readReportState(await searchParams, today);
  const query = new URLSearchParams({ from: state.from, to: state.to });
  if (state.store) query.set('store', state.store);
  const back = `/finance/money-flow?${query}`;
  const lines = new URLSearchParams(query);
  lines.set('back', back);
  const [flow, forecast, options, t] = await Promise.all([
    apiGet<CashFlowReport>(`/finance/cash-flow?${query}`),
    apiGet<CashForecast>('/finance/cash-forecast'),
    reportFilterOptions(),
    getTranslations('finance.period'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('cashTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('cashIntro')}</p>
      <CashFlowView
        flow={flow}
        forecast={forecast}
        linesQuery={lines.toString()}
        filters={
          <ReportFilterBar
            state={{ ...state, compare: 'none', merchant: null }}
            today={today}
            stores={options.stores}
            compare={false}
          />
        }
      />
    </>
  );
}
