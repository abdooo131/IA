import { getTranslations } from 'next-intl/server';
import { InvoiceList } from '@/components/finance/Invoices';
import { FinanceListPage } from '@/components/odoo/FinanceListPage';
import { apiGet } from '@/lib/api-server';
import type { EtaReadiness } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

/** Tax invoices and credit notes: e-invoice state and preparing a month, then the list view. */
export default async function FinanceInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, readiness, t] = await Promise.all([
    searchParams,
    apiGet<EtaReadiness>('/finance/eta/readiness'),
    getTranslations('finance.invoices'),
  ]);
  return (
    <FinanceListPage id="invoices" searchParams={params} title={t('title')} intro={t('intro')}>
      <InvoiceList rows={[]} readiness={readiness} base="/finance/invoices" hideTable />
    </FinanceListPage>
  );
}
