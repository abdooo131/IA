import { canDo, type DocDescriptor } from '@shiplynow/shared';
import { PettyCashItem } from '@/components/finance/PettyCashDesk';
import { DocumentPage } from '@/components/odoo/DocumentPage';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { PettyCashRow } from '@/lib/cash-control-types';

export const dynamic = 'force-dynamic';

/** One petty cash expense: its receipt, entry and request; reverse it with a reason. */
export default async function PettyCashPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [doc, profile] = await Promise.all([
    apiGet<DocDescriptor>(`/finance/documents/petty_cash/${id}`),
    getMyProfile(),
  ]);
  const row = (
    await apiGet<PettyCashRow[]>(`/finance/petty-cash?darkStoreId=${String(doc.data.darkStoreId)}`)
  ).find((r) => r.id === id);
  return (
    <DocumentPage
      doc={doc}
      actions={
        row && row.status === 'posted' && canDo(profile, 'accounting', 'manage') ? (
          <ul className="rounded-lg border border-line">
            <PettyCashItem row={row} canReverse />
          </ul>
        ) : undefined
      }
    />
  );
}
