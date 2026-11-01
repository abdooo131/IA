import { getTranslations } from 'next-intl/server';
import { InvoiceView } from '@/components/finance/InvoiceView';
import { PrintButton } from '@/components/finance/PrintButton';
import { apiGet } from '@/lib/api-server';
import type { InvoiceDetail } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

export default async function MerchantInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [invoice, t] = await Promise.all([
    apiGet<InvoiceDetail>(`/merchant/finance/invoices/${id}`),
    getTranslations('finance.invoices'),
  ]);
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <a
          href="/merchant/invoices"
          className="rounded-md border border-line px-3 py-2 text-body-sm"
        >
          {t('back')}
        </a>
        <PrintButton />
      </div>
      <InvoiceView invoice={invoice} />
    </>
  );
}
