import { StoreReturnWork } from '@/components/returns/StoreReturnWork';
import { BackLink } from '@/components/store/BackLink';
import { apiGet } from '@/lib/api-server';
import type { ReturnDetail } from '@/lib/return-types';

export const dynamic = 'force-dynamic';

export default async function StoreReturnPage({
  params,
}: {
  params: Promise<{ storeId: string; id: string }>;
}) {
  const { storeId, id } = await params;
  const detail = await apiGet<ReturnDetail>(`/stores/${storeId}/returns/${id}`);
  return (
    <>
      <BackLink href={`/store/${storeId}/returns`} />
      <StoreReturnWork storeId={storeId} initial={detail} />
    </>
  );
}
