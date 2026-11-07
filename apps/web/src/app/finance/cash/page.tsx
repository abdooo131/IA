import { getTranslations } from 'next-intl/server';
import { CashDesk } from '@/components/finance/CashDesk';
import { apiGet } from '@/lib/api-server';
import type { CashHandoverRow, FinanceOverview } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

export default async function FinanceCashPage() {
  const [pending, recent, overview, t] = await Promise.all([
    apiGet<CashHandoverRow[]>('/finance/handovers?status=pending'),
    apiGet<CashHandoverRow[]>('/finance/handovers'),
    apiGet<FinanceOverview>('/finance/overview'),
    getTranslations('finance.cash'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <CashDesk pending={pending} recent={recent.slice(0, 50)} stores={overview.stores} />
    </>
  );
}
