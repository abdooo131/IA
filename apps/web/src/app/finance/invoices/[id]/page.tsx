import { canDo, type DocDescriptor } from '@shiplynow/shared';
import { getLocale } from 'next-intl/server';
import { DebitNotes } from '@/components/finance/DebitNoteForm';
import { InvoiceActions } from '@/components/finance/Invoices';
import { InvoiceView } from '@/components/finance/InvoiceView';
import { PrintButton } from '@/components/finance/PrintButton';
import { DocumentPage } from '@/components/odoo/DocumentPage';
import { apiGet, apiTry, getMyProfile } from '@/lib/api-server';
import type { InvoiceDetail, StoreOption } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

/**
 * A tax invoice, credit note or debit note as a document page: the printable document, its
 * actions (credit note, debit note, send again) and chatter.
 */
export default async function FinanceInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [invoice, doc, stores, profile, locale] = await Promise.all([
    apiGet<InvoiceDetail>(`/finance/invoices/${id}`),
    apiGet<DocDescriptor>(`/finance/documents/tax_invoice/${id}`),
    apiTry<StoreOption[]>('/finance/stores'),
    getMyProfile(),
    getLocale(),
  ]);
  return (
    <DocumentPage doc={doc} showFields={false} actions={<PrintButton />}>
      <InvoiceView invoice={invoice} />
      <InvoiceActions invoice={invoice} />
      <DebitNotes
        invoice={invoice}
        canIssue={profile ? canDo(profile, 'accounting', 'use') : false}
        stores={(stores ?? [])
          .filter((s) => s.kind === 'dark_store')
          .map((s) => ({
            id: s.id,
            label: `${locale === 'ar' ? s.nameAr : s.nameEn} (${s.code})`,
          }))}
      />
    </DocumentPage>
  );
}
