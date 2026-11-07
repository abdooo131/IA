import { canDo, type DocDescriptor } from '@shiplynow/shared';
import { RequestCard } from '@/components/finance/Approvals';
import { DocumentPage } from '@/components/odoo/DocumentPage';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { FinanceRequestRow } from '@/lib/finance-types';
import { getCurrentUser } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

/** One request waiting for a second person: approve, reject with a note, or withdraw your own. */
export default async function FinanceRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [doc, profile, me] = await Promise.all([
    apiGet<DocDescriptor>(`/finance/documents/finance_request/${id}`),
    getMyProfile(),
    getCurrentUser(),
  ]);
  const request =
    doc.status === 'pending' && canDo(profile, 'accounting', 'use')
      ? (await apiGet<FinanceRequestRow[]>('/finance/requests?status=pending')).find(
          (r) => r.id === id,
        )
      : undefined;
  return (
    <DocumentPage
      doc={doc}
      actions={
        request ? (
          <ul>
            <RequestCard request={request} meId={me?.id ?? ''} />
          </ul>
        ) : undefined
      }
    />
  );
}
