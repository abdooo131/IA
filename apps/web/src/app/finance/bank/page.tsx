import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { BankMatching, type BankMatchingData } from '@/components/finance/BankMatching';
import { BankReconcile } from '@/components/finance/PeriodReports';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { BankReconciliation, BankStatementRow, BookAccount } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

/** Bank matching: the bank's statement lines against the books, one bank account at a time. */
export default async function FinanceBankPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; statement?: string; month?: string; q?: string }>;
}) {
  const { account, statement, month, q } = await searchParams;
  const [accounts, t, me] = await Promise.all([
    apiGet<BookAccount[]>('/finance/accounts'),
    getTranslations('finance.period'),
    getMyProfile(),
  ]);
  const banks = accounts.filter((a) => a.groupCode === 1100 && a.isActive);
  const chosen = banks.find((b) => b.id === account) ?? banks[0];
  const query = new URLSearchParams();
  if (statement) query.set('statement', statement);
  if (month) query.set('month', month);
  if (q) query.set('q', q);
  const [rec, statements, matching] = await Promise.all([
    chosen
      ? apiGet<BankReconciliation>(`/finance/bank-reconciliation/${chosen.id}`)
      : Promise.resolve(null),
    apiGet<BankStatementRow[]>(
      `/finance/bank-statements${chosen ? `?accountId=${chosen.id}` : ''}`,
    ),
    chosen
      ? apiGet<BankMatchingData>(`/finance/bank-matching/${chosen.id}?${query}`)
      : Promise.resolve(null),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('bankTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('bankIntro')}</p>
      <BankReconcile
        banks={banks}
        rec={rec}
        statements={statements}
        matching={
          matching ? (
            <BankMatching data={matching} canWrite={!!me && canDo(me, 'accounting', 'use')} />
          ) : undefined
        }
      />
    </>
  );
}
