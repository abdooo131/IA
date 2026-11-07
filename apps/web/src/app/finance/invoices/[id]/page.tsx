import type { DocDescriptor } from '@shiplynow/shared';
import { InvoiceActions } from '@/components/finance/Invoices';
import { InvoiceView } from '@/components/finance/InvoiceView';
import { PrintButton } from '@/components/finance/PrintButton';
import { DocumentPage } from '@/components/odoo/DocumentPage';
import { apiGet } from '@/lib/api-server';
import type { InvoiceDetail } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

/** A tax invoice or credit note as a document page: the printable invoice, its actions and chatter. */
export default async function FinanceInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [invoice, doc] = await Promise.all([
    apiGet<InvoiceDetail>(`/finance/invoices/${id}`),
    apiGet<DocDescriptor>(`/finance/documents/tax_invoice/${id}`),
  ]);
  return (
    <DocumentPage doc={doc} showFields={false} actions={<PrintButton />}>
      <InvoiceView invoice={invoice} />
      <InvoiceActions invoice={invoice} />
    </DocumentPage>
  );
}
