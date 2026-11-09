import { canDo, type DocSmartButton } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { OrderDetailScreen } from '@/components/orders/detail/OrderDetailScreen';
import { type DocAttachment, DocumentFrame } from '@/components/odoo/DocumentFrame';
import { apiGet, apiTry, getMyProfile } from '@/lib/api-server';
import type { Risk } from '@/lib/customer-types';
import type { OrderDetail, OrderMoney, OrderNote } from '@/lib/order-types';

export const dynamic = 'force-dynamic';

const CANCELLABLE = ['new', 'accepted', 'picking', 'packed'];

/**
 * The order page framed as an Odoo style document (UX phase C): breadcrumbs back to the list
 * with its filters, previous and next order, smart buttons, then the order page (details and
 * tracking tabs) with the chatter beside it on wide screens. The chatter's notes are the
 * order's team thread; the merchant thread stays in the Notes card of the details tab.
 */
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
  const [order, notes, money, insight, doc, ta, ts] = await Promise.all([
    apiGet<OrderDetail>(api),
    apiTry<OrderNote[]>(`${api}/notes`),
    canDo(profile, 'accounting', 'view') ? apiTry<OrderMoney>(`${api}/money`) : null,
    // Customer insight stays with Shiply Now: admin side only, with customer data access.
    canDo(profile, 'customers', 'view') && profile?.customerData
      ? apiTry<{ customer: { id: string } | null; risk?: Risk }>(`/admin/customers/by-order/${id}`)
      : null,
    apiTry<{ smart: DocSmartButton[]; attachments: DocAttachment[] }>(`${api}/document`),
    getTranslations('apps'),
    getTranslations('orders.statuses'),
  ]);
  // Once picking has started, cancelling undoes store work: operations manage (as the API).
  const cancellable =
    CANCELLABLE.includes(order.status) &&
    (['new', 'accepted'].includes(order.status) || canDo(profile, 'operations', 'manage'));
  return (
    <DocumentFrame
      root={{ label: ta('names.operations'), href: '/admin' }}
      list={{ label: ta('pages.orders'), href: '/admin/orders' }}
      id={order.id}
      number={order.number}
      status={order.status}
      statusLabel={ts(order.status)}
      flow="order"
      header={<></>}
      smart={doc?.smart ?? []}
      attachments={doc?.attachments ?? []}
      entityType="order"
      canWrite={canDo(profile, 'operations', 'use')}
      notes={{ list: `${api}/notes`, post: `${api}/notes`, audience: 'team', maxLength: 1000 }}
      asideFrom="xl"
    >
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
        noteThreads={['merchant']}
        money={money}
        customer={
          insight?.customer && insight.risk ? { id: insight.customer.id, risk: insight.risk } : null
        }
        ticketHref={`/tickets?new=1&about=order/${order.id}`}
      />
    </DocumentFrame>
  );
}
