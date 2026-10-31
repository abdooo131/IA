import { RecordHistory } from '@/components/workflow/RecordHistory';
import { BackLink } from '@/components/store/BackLink';
import { TransferAdminView } from '@/components/transfers/TransferAdminView';
import { apiGet } from '@/lib/api-server';
import type { TransferDetail } from '@/lib/transfer-types';

export const dynamic = 'force-dynamic';

export default async function AdminTransferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await apiGet<TransferDetail>(`/admin/transfers/${id}`);
  return (
    <>
      <BackLink href="/admin/transfers" />
      <TransferAdminView detail={detail} />
      <RecordHistory entityType="transfer" entityId={detail.id} />
    </>
  );
}
