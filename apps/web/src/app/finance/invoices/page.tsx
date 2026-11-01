import { getTranslations } from 'next-intl/server';
import { InvoiceList } from '@/components/finance/Invoices';
import { apiGet } from '@/lib/api-server';
import type { EtaReadiness, InvoiceRow } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

export default async function FinanceInvoicesPage() {
  const [rows, readiness, t] = await Promise.all([
    apiGet<InvoiceRow[]>('/finance/invoices'),
    apiGet<EtaReadiness>('/finance/eta/readiness'),
    getTranslations('finance.invoices'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <InvoiceList rows={rows} readiness={readiness} base="/finance/invoices" />
    </>
  );
}
