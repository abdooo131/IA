import { TransferAdminView } from '@/components/transfers/TransferAdminView';
import { apiGet } from '@/lib/api-server';
import type { TransferDetail } from '@/lib/transfer-types';

export const dynamic = 'force-dynamic';

export default async function AdminTransferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await apiGet<TransferDetail>(`/admin/transfers/${id}`);
  return <TransferAdminView detail={detail} />;
}
