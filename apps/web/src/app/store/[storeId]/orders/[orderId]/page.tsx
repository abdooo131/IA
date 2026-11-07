import { BackLink } from '@/components/store/BackLink';
import { type BoxOption, OrderWork } from '@/components/orders/OrderWork';
import { apiGet } from '@/lib/api-server';
import type { OrderDetail } from '@/lib/order-types';

export const dynamic = 'force-dynamic';

export default async function StoreOrderPage({
  params,
}: {
  params: Promise<{ storeId: string; orderId: string }>;
}) {
  const { storeId, orderId } = await params;
  const [order, boxes] = await Promise.all([
    apiGet<OrderDetail>(`/stores/${storeId}/orders/${orderId}`),
    // Box sizes are optional: the screen works without them.
    apiGet<BoxOption[]>(`/stores/${storeId}/packaging/boxes`).catch(() => [] as BoxOption[]),
  ]);
  return (
    <>
      <BackLink href={`/store/${storeId}/orders`} />
      <OrderWork storeId={storeId} initial={order} boxes={boxes} />
    </>
  );
}
