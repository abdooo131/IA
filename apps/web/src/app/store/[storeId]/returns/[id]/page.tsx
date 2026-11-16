import { StoreReturnWork } from '@/components/returns/StoreReturnWork';
import { BackLink } from '@/components/store/BackLink';
import { canDo } from '@shiplynow/shared';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { ReturnDetail } from '@/lib/return-types';

export const dynamic = 'force-dynamic';

export default async function StoreReturnPage({
  params,
}: {
  params: Promise<{ storeId: string; id: string }>;
}) {
  const { storeId, id } = await params;
  const [detail, profile] = await Promise.all([
    apiGet<ReturnDetail>(`/stores/${storeId}/returns/${id}`),
    getMyProfile(),
  ]);
  return (
    <>
      <BackLink href={`/store/${storeId}/returns`} />
      <StoreReturnWork
        storeId={storeId}
        initial={detail}
        canCloseShort={canDo(profile, 'store', 'manage')}
      />
    </>
  );
}
