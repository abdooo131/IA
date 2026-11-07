import { getTranslations } from 'next-intl/server';
import { Receivables } from '@/components/finance/Payables';
import { apiGet } from '@/lib/api-server';
import type { ReceivableRow } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

export default async function FinanceReceivablesPage() {
  const [rows, t] = await Promise.all([
    apiGet<ReceivableRow[]>('/finance/receivables'),
    getTranslations('finance.payables'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('receivablesTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('receivablesIntro')}</p>
      <Receivables rows={rows} />
    </>
  );
}
