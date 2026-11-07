import { getTranslations } from 'next-intl/server';
import { DrillReportPage } from '@/components/finance/reports/DrillReportPage';

export const dynamic = 'force-dynamic';

/** The trial balance you can click into: debits and credits of every account in a period. */
export default async function FinanceTrialPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const t = await getTranslations('finance.trial');
  const filtered = !!(params.store || params.merchant);
  return (
    <DrillReportPage
      report="trial_balance"
      searchParams={params}
      title={t('title')}
      intro={t('intro')}
      term="trialBalance"
      before={(data) =>
        filtered ? null : (
          <p
            role="status"
            className={`mt-4 inline-block rounded-pill border px-3 py-1 text-body-sm font-bold ${data.result.amountPiastres === 0 ? 'border-line' : 'border-danger text-danger'}`}
          >
            {data.result.amountPiastres === 0 ? t('balanced') : t('notBalanced')}
          </p>
        )
      }
    />
  );
}
