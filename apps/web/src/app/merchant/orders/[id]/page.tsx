import { BackLink } from '@/components/store/BackLink';
import { OrderDetailScreen } from '@/components/orders/detail/OrderDetailScreen';
import { apiGet, apiTry, getMerchantRights } from '@/lib/api-server';
import type { OrderDetail, OrderMoney, OrderNote } from '@/lib/order-types';

export const dynamic = 'force-dynamic';

export default async function MerchantOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; tab?: string }>;
}) {
  const [{ id }, { created, tab }] = await Promise.all([params, searchParams]);
  const api = `/merchant/orders/${id}`;
  const rights = await getMerchantRights();
  const [order, notes, money] = await Promise.all([
    apiGet<OrderDetail>(api),
    apiTry<OrderNote[]>(`${api}/notes`),
    rights?.owner || rights?.rights.includes('money') ? apiTry<OrderMoney>(`${api}/money`) : null,
  ]);
  return (
    <>
      <BackLink href="/merchant/orders" />
      <OrderDetailScreen
        order={order}
        viewer="merchant"
        tab={tab === 'tracking' ? 'tracking' : 'details'}
        basePath="/merchant/orders"
        apiPath={api}
        cancellable={order.status === 'new' || order.status === 'accepted'}
        created={created === '1'}
        notes={notes}
        teamNotes={false}
        money={money}
        customer={null}
      />
    </>
  );
}
