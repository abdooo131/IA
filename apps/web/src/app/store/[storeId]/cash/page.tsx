import { canDo } from '@shiplynow/shared';
import { BackLink } from '@/components/store/BackLink';
import { type CashScreenData, RiderCashScreen } from '@/components/store/RiderCashScreen';
import { StoreWithdrawals } from '@/components/store/StoreWithdrawals';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { WithdrawalView } from '@/lib/rider-wallet';

export const dynamic = 'force-dynamic';

export default async function StoreCashPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  const [data, profile] = await Promise.all([
    apiGet<CashScreenData>(`/stores/${storeId}/cash`),
    getMyProfile(),
  ]);
  // Store managers pay riders' approved cash withdrawals from the store box.
  const manager = canDo(profile, 'store', 'manage');
  const withdrawals = manager
    ? await apiGet<WithdrawalView[]>(`/stores/${storeId}/cash/withdrawals`)
    : [];
  return (
    <>
      <BackLink href={`/store/${storeId}`} />
      <RiderCashScreen storeId={storeId} initial={data} />
      {manager && <StoreWithdrawals storeId={storeId} rows={withdrawals} />}
    </>
  );
}
