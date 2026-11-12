import { getTranslations } from 'next-intl/server';
import { DrillReportPage } from '@/components/finance/reports/DrillReportPage';

export const dynamic = 'force-dynamic';

/** The balance sheet you can click into, as of a Cairo day. */
export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // The earlier address took ?day=: it still opens that day.
  if (typeof params.day === 'string' && !params.to) params.to = params.day;
  const t = await getTranslations('finance.reports');
  const filtered = !!(params.store || params.merchant);
  return (
    <DrillReportPage
      report="balance_sheet"
      searchParams={params}
      title={t('bsTitle')}
      intro={t('bsIntro')}
      term="balanceSheet"
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
