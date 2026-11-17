import { getTranslations } from 'next-intl/server';
import { Recurring } from '@/components/finance/Payables';
import { apiGet } from '@/lib/api-server';
import type { BookAccount, RecurringRow, StoreOption } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

export default async function FinanceRecurringPage() {
  const [rows, accounts, stores, t] = await Promise.all([
    apiGet<RecurringRow[]>('/finance/recurring'),
    apiGet<BookAccount[]>('/finance/accounts'),
    apiGet<StoreOption[]>('/finance/stores'),
    getTranslations('finance.payables'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('recurringTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('recurringIntro')}</p>
      <Recurring rows={rows} accounts={accounts} stores={stores} />
    </>
  );
}
