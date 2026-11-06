import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { OpeningBalances } from '@/components/finance/OpeningBalances';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { BookAccount } from '@/lib/finance-types';
import { isOwner } from '@/lib/apps';

export const dynamic = 'force-dynamic';

export default async function FinanceOpeningPage() {
  if (!isOwner(await getMyProfile())) notFound();
  const [accounts, journal, t] = await Promise.all([
    apiGet<BookAccount[]>('/finance/accounts'),
    apiGet<{ rows: { kind: string }[] }>('/finance/ledger?kind=opening_balance'),
    getTranslations('finance.opening'),
  ]);
  // Opening balances is the account the difference goes to; it is never typed into.
  const typed = accounts.filter(
    (a) =>
      a.isActive && a.groupCode !== 3300 && a.category !== 'revenue' && a.category !== 'expense',
  );
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <OpeningBalances
        accounts={typed}
        posted={journal.rows.some((r) => r.kind === 'opening_balance')}
      />
    </>
  );
}
