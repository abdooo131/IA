import { BackLink } from '@/components/store/BackLink';
import { StoreTransferWork } from '@/components/transfers/StoreTransferWork';
import { apiGet } from '@/lib/api-server';
import type { TransferDetail } from '@/lib/transfer-types';

export const dynamic = 'force-dynamic';

export default async function StoreTransferPage({
  params,
}: {
  params: Promise<{ storeId: string; id: string }>;
}) {
  const { storeId, id } = await params;
  const detail = await apiGet<TransferDetail>(`/stores/${storeId}/transfers/${id}`);
  return (
    <>
      <BackLink href={`/store/${storeId}/transfers`} />
      <StoreTransferWork storeId={storeId} initial={detail} />
    </>
  );
}
