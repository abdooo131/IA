import { getTranslations } from 'next-intl/server';
import { AccountsManager } from '@/components/finance/AccountsManager';
import { apiGet } from '@/lib/api-server';
import type { BookAccount } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

export default async function FinanceAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const all = (await searchParams).all === 'true';
  const [accounts, t] = await Promise.all([
    apiGet<BookAccount[]>(`/finance/accounts${all ? '?all=true' : ''}`),
    getTranslations('finance.accounts'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <AccountsManager accounts={accounts} showClosed={all} />
    </>
  );
}
