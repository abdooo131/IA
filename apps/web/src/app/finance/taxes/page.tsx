import { getTranslations } from 'next-intl/server';
import { Taxes } from '@/components/finance/Payables';
import { apiGet } from '@/lib/api-server';
import type { BookAccount, TaxesOwed, WhtReport } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

export default async function FinanceTaxesPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; quarter?: string }>;
}) {
  const q = await searchParams;
  const query = new URLSearchParams();
  if (q.year && /^\d{4}$/.test(q.year)) query.set('year', q.year);
  if (q.quarter && /^[1-4]$/.test(q.quarter)) query.set('quarter', q.quarter);
  const [owed, report, accounts, t] = await Promise.all([
    apiGet<TaxesOwed>('/finance/taxes'),
    apiGet<WhtReport>(`/finance/taxes/withholding?${query.toString()}`),
    apiGet<BookAccount[]>('/finance/accounts'),
    getTranslations('finance.payables'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('taxesTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('taxesIntro')}</p>
      <Taxes owed={owed} report={report} accounts={accounts} />
    </>
  );
}
