import { BackLink } from '@/components/store/BackLink';
import { OrderWork } from '@/components/orders/OrderWork';
import { apiGet } from '@/lib/api-server';
import type { OrderDetail } from '@/lib/order-types';

export const dynamic = 'force-dynamic';

export default async function StoreOrderPage({ params }: { params: Promise<{ storeId: string; orderId: string }> }) {
  const { storeId, orderId } = await params;
  const order = await apiGet<OrderDetail>(`/stores/${storeId}/orders/${orderId}`);
  return (
    <>
      <BackLink href={`/store/${storeId}/orders`} />
      <OrderWork storeId={storeId} initial={order} />
    </>
  );
}
