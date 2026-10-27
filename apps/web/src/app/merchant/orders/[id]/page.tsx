import { BackLink } from '@/components/store/BackLink';
import { OrderReadView } from '@/components/orders/OrderReadView';
import { apiGet } from '@/lib/api-server';
import type { OrderDetail } from '@/lib/order-types';

export const dynamic = 'force-dynamic';

export default async function MerchantOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const [{ id }, { created }] = await Promise.all([params, searchParams]);
  const order = await apiGet<OrderDetail>(`/merchant/orders/${id}`);
  return (
    <>
      <BackLink href="/merchant/orders" />
      <OrderReadView
        order={order}
        created={created === '1'}
        cancelPath={`/merchant/orders/${id}/cancel`}
        decisionPath={`/merchant/orders/${id}/decision`}
        cancellable={order.status === 'new' || order.status === 'accepted'}
      />
    </>
  );
}
