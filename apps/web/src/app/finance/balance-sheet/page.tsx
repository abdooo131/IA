import { cairoDay } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { ReportTable } from '@/components/finance/ReportTable';
import { apiGet } from '@/lib/api-server';
import type { BalanceSheet } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const q = await searchParams;
  const today = cairoDay(new Date());
  const day = q.day && DAY.test(q.day) ? q.day : today;
  const [sheet, t, tf] = await Promise.all([
    apiGet<BalanceSheet>(`/finance/balance-sheet?day=${day}`),
    getTranslations('finance.reports'),
    getTranslations('finance'),
  ]);
  const balanced =
    sheet.totalAssetsPiastres === sheet.totalLiabilitiesPiastres + sheet.totalEquityPiastres;
  const field = 'mt-1 block h-10 rounded-md border border-line bg-surface px-2 text-body-sm';
  return (
    <>
      <h1 className="text-h2">{t('bsTitle')}</h1>
      <p className="mt-1 text-body-sm text-text-muted">{t('bsIntro')}</p>
      <form className="mt-4 flex flex-wrap items-end gap-3" method="get">
        <label className="text-caption">
          {t('asOf')}
          <input
            type="date"
            name="day"
            defaultValue={day}
            max={today}
            dir="ltr"
            className={field}
          />
        </label>
        <button
          type="submit"
          className="h-10 rounded-md bg-selected-bg px-4 text-body-sm font-bold text-link"
        >
          {tf('apply')}
        </button>
      </form>
      <p
        role="status"
        className={`mt-4 inline-block rounded-pill border px-3 py-1 text-body-sm font-bold ${balanced ? 'border-line' : 'border-danger text-danger'}`}
      >
        {balanced ? t('balanced') : t('notBalanced')}
      </p>
      <div className="mt-4 grid max-w-4xl gap-4">
        <ReportTable
          title={t('assets')}
          lines={sheet.assets}
          totalLabel={t('totalAssets')}
          total={sheet.totalAssetsPiastres}
        />
        <ReportTable
          title={t('liabilities')}
          lines={sheet.liabilities}
          totalLabel={t('totalLiabilities')}
          total={sheet.totalLiabilitiesPiastres}
        />
        <ReportTable
          title={t('equity')}
          lines={sheet.equity}
          totalLabel={t('totalEquity')}
          total={sheet.totalEquityPiastres}
          extra={{ label: t('earnings'), amount: sheet.earningsPiastres }}
        />
      </div>
    </>
  );
}
