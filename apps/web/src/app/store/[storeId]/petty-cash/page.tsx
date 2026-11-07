import { BackLink } from '@/components/store/BackLink';
import { PettyCashScreen } from '@/components/store/PettyCashScreen';
import { apiGet } from '@/lib/api-server';
import type { StorePettyCash } from '@/lib/cash-control-types';

export const dynamic = 'force-dynamic';

export default async function StorePettyCashPage({
  params,
}: {
  params: Promise<{ storeId: string }>;
}) {
  const { storeId } = await params;
  const data = await apiGet<StorePettyCash>(`/stores/${storeId}/petty-cash`);
  return (
    <>
      <BackLink href={`/store/${storeId}`} />
      <PettyCashScreen storeId={storeId} initial={data} />
    </>
  );
}
