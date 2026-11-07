import type { DocDescriptor } from '@shiplynow/shared';
import { PrintButton } from '@/components/finance/PrintButton';
import { DocumentPage } from '@/components/odoo/DocumentPage';
import { apiGet } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

/** One journal entry: its lines (debit and credit), the document it was posted for, receipts. */
export default async function JournalEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await apiGet<DocDescriptor>(`/finance/documents/ledger_entry/${id}`);
  return <DocumentPage doc={doc} actions={<PrintButton />} />;
}
