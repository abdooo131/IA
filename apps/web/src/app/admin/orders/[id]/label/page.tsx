import { BackLink } from '@/components/store/BackLink';
import { OrderLabel } from '@/components/orders/detail/OrderLabel';
import { apiGet } from '@/lib/api-server';
import type { OrderDetail } from '@/lib/order-types';

export const dynamic = 'force-dynamic';

export default async function AdminOrderLabelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await apiGet<OrderDetail>(`/admin/orders/${id}`);
  return (
    <>
      <div className="mb-3 print:hidden">
        <BackLink href={`/admin/orders/${id}`} />
      </div>
      <OrderLabel order={order} />
    </>
  );
}
