import { getTranslations } from 'next-intl/server';
import { YearEnd } from '@/components/finance/PeriodReports';
import { apiGet } from '@/lib/api-server';
import type { YearStatus } from '@/lib/finance-types';
import { FinanceTabs } from '@/components/finance/FinanceTabs';

export const dynamic = 'force-dynamic';

export default async function FinanceYearEndPage() {
  const [years, t] = await Promise.all([
    apiGet<YearStatus[]>('/finance/year-close'),
    getTranslations('finance.period'),
  ]);
  return (
    <>
      <FinanceTabs family="closing" />
      <h1 className="text-h2">{t('yearTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('yearIntro')}</p>
      <YearEnd years={years} />
    </>
  );
}
