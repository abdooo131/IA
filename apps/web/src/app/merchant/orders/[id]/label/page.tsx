import { BackLink } from '@/components/store/BackLink';
import { OrderLabel } from '@/components/orders/detail/OrderLabel';
import { apiGet } from '@/lib/api-server';
import type { OrderDetail } from '@/lib/order-types';

export const dynamic = 'force-dynamic';

export default async function MerchantOrderLabelPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await apiGet<OrderDetail>(`/merchant/orders/${id}`);
  return (
    <>
      <div className="mb-3 print:hidden">
        <BackLink href={`/merchant/orders/${id}`} />
      </div>
      <OrderLabel order={order} />
    </>
  );
}
