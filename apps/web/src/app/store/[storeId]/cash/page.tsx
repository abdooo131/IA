import { BackLink } from '@/components/store/BackLink';
import { type CashScreenData, RiderCashScreen } from '@/components/store/RiderCashScreen';
import { apiGet } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export default async function StoreCashPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const data = await apiGet<CashScreenData>(`/stores/${storeId}/cash`);
  return (
    <>
      <BackLink href={`/store/${storeId}`} />
      <RiderCashScreen storeId={storeId} initial={data} />
    </>
  );
}
