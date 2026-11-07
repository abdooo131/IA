import { getTranslations } from 'next-intl/server';
import { BankReconcile } from '@/components/finance/PeriodReports';
import { apiGet } from '@/lib/api-server';
import type { BankReconciliation, BankStatementRow, BookAccount } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

export default async function FinanceBankPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  const { account } = await searchParams;
  const [accounts, t] = await Promise.all([
    apiGet<BookAccount[]>('/finance/accounts'),
    getTranslations('finance.period'),
  ]);
  const banks = accounts.filter((a) => a.groupCode === 1100 && a.isActive);
  const chosen = banks.find((b) => b.id === account) ?? banks[0];
  const [rec, statements] = await Promise.all([
    chosen
      ? apiGet<BankReconciliation>(`/finance/bank-reconciliation/${chosen.id}`)
      : Promise.resolve(null),
    apiGet<BankStatementRow[]>(
      `/finance/bank-statements${chosen ? `?accountId=${chosen.id}` : ''}`,
    ),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('bankTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('bankIntro')}</p>
      <BankReconcile banks={banks} rec={rec} statements={statements} />
    </>
  );
}
