import { BackLink } from '@/components/store/BackLink';
import { OrderReadView } from '@/components/orders/OrderReadView';
import { apiGet } from '@/lib/api-server';
import type { OrderDetail } from '@/lib/order-types';

export const dynamic = 'force-dynamic';

export default async function AdminOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const [{ id }, { created }] = await Promise.all([params, searchParams]);
  const order = await apiGet<OrderDetail>(`/admin/orders/${id}`);
  return (
    <>
      <BackLink href="/admin/orders" />
      <OrderReadView
        order={order}
        created={created === '1'}
        cancelPath={`/admin/orders/${id}/cancel`}
        cancellable={['new', 'accepted', 'picking', 'packed'].includes(order.status)}
      />
    </>
  );
}
