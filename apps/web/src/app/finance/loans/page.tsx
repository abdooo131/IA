import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { type LoanRow, LoansTable, NewLoan } from '@/components/finance/LoansFx';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { BookAccount } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

/** Loans the company borrowed: what is owed on each, the next instalment, and a new loan. */
export default async function FinanceLoansPage() {
  const [loans, profile, t] = await Promise.all([
    apiGet<LoanRow[]>('/finance/loans'),
    getMyProfile(),
    getTranslations('loansFx.loans'),
  ]);
  const canUse = canDo(profile, 'accounting', 'use');
  const accounts = canUse ? await apiGet<BookAccount[]>('/finance/accounts') : [];
  // A bank loan comes into one of our EGP bank accounts (group 1100; the books are in EGP).
  const money = accounts.filter(
    (a) => a.money && a.isActive && a.code.startsWith('11') && (a.currency ?? 'EGP') === 'EGP',
  );
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <div className="mt-4 space-y-6">
        <LoansTable loans={loans} />
        {canUse && <NewLoan money={money} />}
      </div>
    </>
  );
}
