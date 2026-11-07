import { canDo, type DocDescriptor } from '@shiplynow/shared';
import { WithdrawalCard } from '@/components/finance/RiderWithdrawals';
import { DocumentPage } from '@/components/odoo/DocumentPage';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { WithdrawalList } from '@/lib/rider-wallet';

export const dynamic = 'force-dynamic';

/** One rider withdrawal: approve or reject it, then mark it paid. */
export default async function RiderWithdrawalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [doc, profile] = await Promise.all([
    apiGet<DocDescriptor>(`/finance/documents/rider_withdrawal/${id}`),
    getMyProfile(),
  ]);
  const open = doc.status === 'requested' || doc.status === 'approved';
  const list = open
    ? await apiGet<WithdrawalList>(
        `/finance/rider-withdrawals?status=${doc.status}&darkStoreId=${String(doc.data.darkStoreId)}`,
      )
    : null;
  const w = list?.withdrawals.find((x) => x.id === id);
  return (
    <DocumentPage
      doc={doc}
      actions={
        w ? (
          <ul>
            <WithdrawalCard w={w} canUse={canDo(profile, 'accounting', 'use')} />
          </ul>
        ) : undefined
      }
    />
  );
}
