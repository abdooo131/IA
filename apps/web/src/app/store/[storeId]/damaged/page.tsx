import { BackLink } from '@/components/store/BackLink';
import { DamagedScreen } from '@/components/store/DamagedScreen';
import { apiGet } from '@/lib/api-server';
import type { BinWithItems } from '@/lib/store-types';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const bins = await apiGet<BinWithItems[]>(`/stores/${storeId}/bins`);
  return (
    <>
      <BackLink href={`/store/${storeId}`} />
      <DamagedScreen storeId={storeId} initialBins={bins} />
    </>
  );
}
