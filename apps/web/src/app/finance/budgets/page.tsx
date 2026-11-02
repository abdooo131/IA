import { getTranslations } from 'next-intl/server';
import { Budgets } from '@/components/finance/PeriodReports';
import { apiGet } from '@/lib/api-server';
import type { BudgetReport, StoreOption } from '@/lib/finance-types';
import { FinanceTabs } from '@/components/finance/FinanceTabs';

export const dynamic = 'force-dynamic';

export default async function FinanceBudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; storeId?: string }>;
}) {
  const q = await searchParams;
  const query = new URLSearchParams();
  if (q.month && /^\d{4}-\d{2}$/.test(q.month)) query.set('month', q.month);
  if (q.storeId) query.set('storeId', q.storeId);
  const [report, stores, t] = await Promise.all([
    apiGet<BudgetReport>(`/finance/budgets?${query.toString()}`),
    apiGet<StoreOption[]>('/finance/stores'),
    getTranslations('finance.period'),
  ]);
  return (
    <>
      <FinanceTabs family="reports" />
      <h1 className="text-h2">{t('budgetsTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('budgetsIntro')}</p>
      <Budgets report={report} stores={stores} />
    </>
  );
}
