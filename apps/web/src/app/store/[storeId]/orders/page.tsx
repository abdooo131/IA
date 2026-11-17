import { BackLink } from '@/components/store/BackLink';
import { OrdersQueue } from '@/components/orders/OrdersQueue';
import { apiGet } from '@/lib/api-server';
import type { OrderSummary } from '@/lib/order-types';

export const dynamic = 'force-dynamic';

export default async function StoreOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { storeId } = await params;
  const view = (await searchParams).view === 'done' ? 'done' : 'active';
  const orders = await apiGet<OrderSummary[]>(`/stores/${storeId}/orders?view=${view}`);
  return (
    <>
      <BackLink href={`/store/${storeId}`} />
      <OrdersQueue storeId={storeId} view={view} initial={orders} />
    </>
  );
}
