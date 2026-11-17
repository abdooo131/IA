import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { OrdersTable } from '@/components/orders/OrdersTable';
import { apiGet } from '@/lib/api-server';
import { ORDER_STATUS_LIST, type OrderSummary } from '@/lib/order-types';

export const dynamic = 'force-dynamic';

export default async function MerchantOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const filters = await searchParams;
  const query = new URLSearchParams();
  if (filters.status) query.set('status', filters.status);
  if (filters.q) query.set('q', filters.q);
  const [orders, t, statuses] = await Promise.all([
    apiGet<OrderSummary[]>(`/merchant/orders?${query}`),
    getTranslations('merchant.orders'),
    getTranslations('orders.statuses'),
  ]);
  const field = 'h-10 rounded-md border border-line bg-surface px-2 text-body-sm';
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-h2">{t('title')}</h1>
        <Link
          href="/merchant/orders/new"
          className="flex h-10 items-center rounded-md bg-primary px-4 font-bold text-on-primary"
        >
          {t('new')}
        </Link>
      </div>
      <form className="mt-4 flex flex-wrap gap-2" method="get">
        <select
          name="status"
          defaultValue={filters.status ?? ''}
          className={field}
          aria-label={t('allStatuses')}
        >
          <option value="">{t('allStatuses')}</option>
          {ORDER_STATUS_LIST.map((s) => (
            <option key={s} value={s}>
              {statuses(s)}
            </option>
          ))}
        </select>
        <input
          name="q"
          defaultValue={filters.q ?? ''}
          placeholder={t('search')}
          dir="ltr"
          className={`${field} w-56`}
        />
        <button
          type="submit"
          className="h-10 rounded-md bg-selected-bg px-4 text-body-sm font-bold text-link"
        >
          {t('filter')}
        </button>
      </form>
      <OrdersTable orders={orders} hrefBase="/merchant/orders" />
    </>
  );
}
