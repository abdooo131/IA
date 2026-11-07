import { getTranslations } from 'next-intl/server';
import { DrillReportPage } from '@/components/finance/reports/DrillReportPage';

export const dynamic = 'force-dynamic';

/** Profit and loss you can click into: each account opens its ledger lines. */
export default async function ProfitAndLossPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations('finance.reports');
  return (
    <DrillReportPage
      report="profit_and_loss"
      searchParams={await searchParams}
      title={t('plTitle')}
      intro={t('plIntro')}
    />
  );
}
