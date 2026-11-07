import { canDo, type DocDescriptor } from '@shiplynow/shared';
import { DraftCard } from '@/components/finance/PayoutsManager';
import { DocumentPage } from '@/components/odoo/DocumentPage';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { PayoutRow } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

/** One payout: approve (a second person), mark paid with the bank reference, or cancel. */
export default async function FinancePayoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [doc, profile] = await Promise.all([
    apiGet<DocDescriptor>(`/finance/documents/payout/${id}`),
    getMyProfile(),
  ]);
  const draft =
    doc.status === 'draft' && canDo(profile, 'accounting', 'use')
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
            <DraftCard payout={draft} />
          </ul>
        ) : undefined
      }
    />
  );
}
