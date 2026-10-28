import { addDays, cairoDay } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { Amount } from '@/components/finance/Amount';
import { ReportTable } from '@/components/finance/ReportTable';
import { apiGet } from '@/lib/api-server';
import type { ProfitAndLoss } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export default async function ProfitAndLossPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const q = await searchParams;
  const today = cairoDay(new Date());
  const from = q.from && DAY.test(q.from) ? q.from : `${today.slice(0, 8)}01`;
  const to = q.to && DAY.test(q.to) ? q.to : today;
  const [pl, t, tf] = await Promise.all([
    apiGet<ProfitAndLoss>(`/finance/profit-and-loss?${new URLSearchParams({ from, to })}`),
    getTranslations('finance.reports'),
    getTranslations('finance'),
  ]);
  const field = 'mt-1 block h-10 rounded-md border border-line bg-surface px-2 text-body-sm';
  return (
    <>
      <h1 className="text-h2">{t('plTitle')}</h1>
      <p className="mt-1 text-body-sm text-text-muted">{t('plIntro')}</p>
      <form className="mt-4 flex flex-wrap items-end gap-3" method="get">
        <label className="text-caption">
          {tf('from')}
          <input type="date" name="from" defaultValue={from} dir="ltr" className={field} />
        </label>
        <label className="text-caption">
          {tf('to')}
          <input
            type="date"
            name="to"
            defaultValue={to}
            max={addDays(today, 0)}
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
      <div className="mt-4 grid max-w-4xl gap-4">
        <ReportTable
          title={t('income')}
          lines={pl.income}
          totalLabel={t('totalIncome')}
          total={pl.totalIncomePiastres}
        />
        <ReportTable
          title={t('expenses')}
          lines={pl.expenses}
          totalLabel={t('totalExpenses')}
          total={pl.totalExpensesPiastres}
        />
        <p className="rounded-lg border border-line bg-surface p-4 text-h3">
          {pl.profitPiastres >= 0 ? t('profit') : t('loss')}:{' '}
          <Amount piastres={pl.profitPiastres} strong /> EGP
        </p>
      </div>
    </>
  );
}
