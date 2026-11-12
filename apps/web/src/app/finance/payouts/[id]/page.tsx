import { canDo, type DocDescriptor } from '@shiplynow/shared';
import { DraftCard } from '@/components/finance/PayoutsManager';
import { PayoutControls } from '@/components/finance/PayoutControls';
import { DocumentPage } from '@/components/odoo/DocumentPage';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { PayoutControlsData, PayoutRow } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

/**
 * One payout: its statement of account, proof of transfer and checks, then approve (a second
 * person), mark paid (the reference defaults to the slip's) or cancel.
 */
export default async function FinancePayoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [doc, controls, profile] = await Promise.all([
    apiGet<DocDescriptor>(`/finance/documents/payout/${id}`),
    apiGet<PayoutControlsData>(`/finance/payouts/${id}/controls`),
    getMyProfile(),
  ]);
  const canWrite = canDo(profile, 'accounting', 'use');
  const draft =
    doc.status === 'draft' && canWrite
      ? (
          await apiGet<PayoutRow[]>(
            `/finance/payouts?status=draft&merchantId=${String(doc.data.merchantId)}`,
          )
        ).find((p) => p.id === id)
      : undefined;
  return (
    <DocumentPage
      doc={doc}
      actions={
        draft ? (
          <ul>
            <DraftCard payout={draft} blockers={controls.blockers} cheque={controls.cheque} />
          </ul>
        ) : undefined
      }
    >
      <div className="mt-4">
        <PayoutControls data={controls} canWrite={canWrite} />
      </div>
    </DocumentPage>
  );
}
