import { cairoDay, type DrillReport, type DrillReportResult } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { InfoTip, type InfoTerm } from '@/components/odoo/InfoTip';
import { apiGet, apiTry } from '@/lib/api-server';
import type { FinanceOverview, StoreOption } from '@/lib/finance-types';
import { readReportState, reportQuery } from '@/lib/report-view';
import { DrillReportView } from './DrillReportView';
import { type FilterOption, ReportFilterBar } from './ReportFilterBar';

/** The store and merchant choices of the report filters, in the reader's language. */
export async function reportFilterOptions(): Promise<{
  stores: FilterOption[];
  merchants: FilterOption[];
}> {
  const [stores, overview, locale] = await Promise.all([
    apiTry<StoreOption[]>('/finance/stores'),
    apiTry<FinanceOverview>('/finance/overview'),
    getLocale(),
  ]);
  return {
    stores: (stores ?? []).map((s) => ({
      id: s.id,
      label: `${locale === 'ar' ? s.nameAr : s.nameEn} (${s.code})`,
    })),
    merchants: (overview?.merchants ?? [])
      .map((m) => ({ id: m.id, label: m.name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}

/** A drill down report page: title, filters, the report and its exports. */
export async function DrillReportPage({
  report,
  searchParams,
  title,
  intro,
  term,
  before,
}: {
  report: DrillReport;
  searchParams: Record<string, string | string[] | undefined>;
  title: string;
  intro: string;
  term?: InfoTerm;
  /** A status line above the report (the balance sheet balances) */
  before?: (data: DrillReportResult) => ReactNode;
}) {
  const today = cairoDay(new Date());
  const state = readReportState(searchParams, today);
  const [data, options, t] = await Promise.all([
    apiGet<DrillReportResult>(`/finance/reports/${report}?${reportQuery(state)}`),
    reportFilterOptions(),
    getTranslations('finance.drill'),
  ]);
  return (
    <>
      <h1 className="text-h2">
        {title} {term && <InfoTip term={term} />}
      </h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{intro}</p>
      <ReportFilterBar
        state={state}
        today={today}
        stores={options.stores}
        merchants={options.merchants}
        asOf={report === 'balance_sheet'}
      />
      {(state.store || state.merchant) && (
        <p className="mt-2 text-caption text-text-muted">{t('filteredHint')}</p>
      )}
      {before?.(data)}
      <DrillReportView report={data} state={state} exportName={t(`files.${report}`)} />
    </>
  );
}
