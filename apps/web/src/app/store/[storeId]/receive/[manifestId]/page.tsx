import { BackLink } from '@/components/store/BackLink';
import { ReceiveScreen } from '@/components/store/ReceiveScreen';
import { apiGet } from '@/lib/api-server';
import type { ManifestDetail } from '@/lib/store-types';

export const dynamic = 'force-dynamic';

export default async function ReceivePage({
  params,
}: {
  params: Promise<{ storeId: string; manifestId: string }>;
}) {
  const { storeId, manifestId } = await params;
  const manifest = await apiGet<ManifestDetail>(`/stores/${storeId}/manifests/${manifestId}`);
  return (
    <>
      <BackLink href={`/store/${storeId}/receive`} />
      <ReceiveScreen storeId={storeId} initial={manifest} />
    </>
  );
}
