import { BackLink } from '@/components/store/BackLink';
import { CountScreen } from '@/components/store/CountScreen';
import { apiGet } from '@/lib/api-server';
import type { BinWithItems } from '@/lib/store-types';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const bins = await apiGet<BinWithItems[]>(`/stores/${storeId}/bins`);
  return (
    <>
      <BackLink href={`/store/${storeId}`} />
      <CountScreen storeId={storeId} initialBins={bins} />
    </>
  );
}
