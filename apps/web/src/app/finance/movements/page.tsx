import { getTranslations } from 'next-intl/server';
import { MoneyMovements, type MovementTab } from '@/components/finance/MoneyMovements';
import { apiGet } from '@/lib/api-server';
import type { BookAccount } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';
const TABS: MovementTab[] = ['transfer', 'expense', 'capital', 'income', 'journal'];

export default async function FinanceMovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const tab = (await searchParams).tab as MovementTab;
  const [accounts, t] = await Promise.all([
    apiGet<BookAccount[]>('/finance/accounts'),
    getTranslations('finance.movements'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <MoneyMovements accounts={accounts} tab={TABS.includes(tab) ? tab : 'transfer'} />
    </>
  );
}
