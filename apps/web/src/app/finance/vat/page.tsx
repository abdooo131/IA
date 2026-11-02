import { getTranslations } from 'next-intl/server';
import { VatView } from '@/components/finance/PeriodReports';
import { apiGet } from '@/lib/api-server';
import type { VatReport } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

export default async function FinanceVatPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year } = await searchParams;
  const [report, t] = await Promise.all([
    apiGet<VatReport>(`/finance/vat-report${year && /^\d{4}$/.test(year) ? `?year=${year}` : ''}`),
    getTranslations('finance.period'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('vatTitle', { year: report.year })}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('vatIntro')}</p>
      <VatView report={report} />
    </>
  );
}
