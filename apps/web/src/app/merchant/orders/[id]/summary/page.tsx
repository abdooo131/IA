import { BackLink } from '@/components/store/BackLink';
import { OrderSummarySheet } from '@/components/orders/detail/OrderSummarySheet';
import { apiGet, apiTry, getMerchantRights } from '@/lib/api-server';
import type { OrderDetail, OrderMoney } from '@/lib/order-types';

export const dynamic = 'force-dynamic';

export default async function MerchantOrderSummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const rights = await getMerchantRights();
  const [order, money] = await Promise.all([
    apiGet<OrderDetail>(`/merchant/orders/${id}`),
    rights?.owner || rights?.rights.includes('money')
      ? apiTry<OrderMoney>(`/merchant/orders/${id}/money`)
      : null,
  ]);
  return (
    <>
      <div className="print:hidden">
        <BackLink href={`/merchant/orders/${id}`} />
      </div>
      <OrderSummarySheet order={order} money={money} showMerchant={false} />
    </>
  );
}
