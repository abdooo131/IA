import { canDo } from '@shiplynow/shared';
import { BackLink } from '@/components/store/BackLink';
import { OrderSummarySheet } from '@/components/orders/detail/OrderSummarySheet';
import { apiGet, apiTry, getMyProfile } from '@/lib/api-server';
import type { OrderDetail, OrderMoney } from '@/lib/order-types';

export const dynamic = 'force-dynamic';

export default async function AdminOrderSummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getMyProfile();
  const [order, money] = await Promise.all([
    apiGet<OrderDetail>(`/admin/orders/${id}`),
    canDo(profile, 'accounting', 'view') ? apiTry<OrderMoney>(`/admin/orders/${id}/money`) : null,
  ]);
  return (
    <>
      <div className="print:hidden">
        <BackLink href={`/admin/orders/${id}`} />
      </div>
      <OrderSummarySheet order={order} money={money} showMerchant />
    </>
  );
}
