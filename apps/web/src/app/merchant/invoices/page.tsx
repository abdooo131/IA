import { getTranslations } from 'next-intl/server';
import { InvoiceList } from '@/components/finance/Invoices';
import { apiGet } from '@/lib/api-server';
import type { InvoiceRow } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

export default async function MerchantInvoicesPage() {
  const [rows, t] = await Promise.all([
    apiGet<InvoiceRow[]>('/merchant/finance/invoices'),
    getTranslations('finance.invoices'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('merchantTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('merchantIntro')}</p>
      <InvoiceList rows={rows} readiness={null} base="/merchant/invoices" />
    </>
  );
}
