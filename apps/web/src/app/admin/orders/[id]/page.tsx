import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { RecordHistory } from '@/components/workflow/RecordHistory';
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
  const [order, t] = await Promise.all([
    apiGet<OrderDetail>(`/admin/orders/${id}`),
    getTranslations('tickets'),
  ]);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BackLink href="/admin/orders" />
        <Link
          href={`/tickets?new=1&about=order/${order.id}`}
          className="text-body-sm font-bold text-link"
        >
          {t('ask')}
        </Link>
      </div>
      <OrderReadView
        order={order}
        created={created === '1'}
        cancelPath={`/admin/orders/${id}/cancel`}
        decisionPath={`/admin/orders/${id}/decision`}
        cancellable={['new', 'accepted', 'picking', 'packed'].includes(order.status)}
      />
      <RecordHistory entityType="order" entityId={order.id} />
    </>
  );
}
