import { canDo } from '@shiplynow/shared';
import { BackLink } from '@/components/store/BackLink';
import { OrderDetailScreen } from '@/components/orders/detail/OrderDetailScreen';
import { RecordHistory } from '@/components/workflow/RecordHistory';
import { apiGet, apiTry, getMyProfile } from '@/lib/api-server';
import type { Risk } from '@/lib/customer-types';
import type { OrderDetail, OrderMoney, OrderNote } from '@/lib/order-types';

export const dynamic = 'force-dynamic';

const CANCELLABLE = ['new', 'accepted', 'picking', 'packed'];

export default async function AdminOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; tab?: string }>;
}) {
  const [{ id }, { created, tab }] = await Promise.all([params, searchParams]);
  const profile = await getMyProfile();
  const api = `/admin/orders/${id}`;
  const [order, notes, money, insight] = await Promise.all([
    apiGet<OrderDetail>(api),
    apiTry<OrderNote[]>(`${api}/notes`),
    canDo(profile, 'accounting', 'view') ? apiTry<OrderMoney>(`${api}/money`) : null,
    // Customer insight stays with Shiply Now: admin side only, with customer data access.
    canDo(profile, 'customers', 'view') && profile?.customerData
      ? apiTry<{ customer: { id: string } | null; risk?: Risk }>(`/admin/customers/by-order/${id}`)
      : null,
  ]);
  // Once picking has started, cancelling undoes store work: operations manage (as the API).
  const cancellable =
    CANCELLABLE.includes(order.status) &&
    (['new', 'accepted'].includes(order.status) || canDo(profile, 'operations', 'manage'));
  return (
    <>
      <BackLink href="/admin/orders" />
      <OrderDetailScreen
        order={order}
        viewer="admin"
        tab={tab === 'tracking' ? 'tracking' : 'details'}
        basePath="/admin/orders"
        apiPath={api}
        cancellable={cancellable}
        created={created === '1'}
        notes={notes}
        teamNotes
        money={money}
        customer={
          insight?.customer && insight.risk ? { id: insight.customer.id, risk: insight.risk } : null
        }
        ticketHref={`/tickets?new=1&about=order/${order.id}`}
        history={<RecordHistory entityType="order" entityId={order.id} />}
      />
    </>
  );
}
