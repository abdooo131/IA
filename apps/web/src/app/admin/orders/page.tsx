import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { OrdersTable } from '@/components/orders/OrdersTable';
import { type AdminStore, localized } from '@/lib/admin-types';
import { apiGet } from '@/lib/api-server';
import { ORDER_STATUS_LIST, type OrderSummary } from '@/lib/order-types';

export const dynamic = 'force-dynamic';

type Filters = {
  status?: string;
  store?: string;
  merchant?: string;
  q?: string;
  from?: string;
  to?: string;
  late?: string;
};

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Filters>;
}) {
  const filters = await searchParams;
  const query = new URLSearchParams();
  if (filters.status) query.set('status', filters.status);
  if (filters.store) query.set('darkStoreId', filters.store);
  if (filters.merchant) query.set('merchantId', filters.merchant);
  if (filters.q) query.set('q', filters.q);
  // Dates are Cairo calendar days; the API takes instants.
  if (filters.from) query.set('from', `${filters.from}T00:00:00+02:00`);
  if (filters.to) query.set('to', `${filters.to}T23:59:59+02:00`);
  if (filters.late === 'true') query.set('late', 'true');

  const [orders, stores, merchants, t, statuses, locale] = await Promise.all([
    apiGet<OrderSummary[]>(`/admin/orders?${query}`),
    apiGet<AdminStore[]>('/admin/dark-stores'),
    apiGet<{ id: string; name: string }[]>('/admin/merchants'),
    getTranslations('admin.orders'),
    getTranslations('orders.statuses'),
    getLocale(),
  ]);
  const field = 'h-10 rounded-md border border-line bg-surface px-2 text-body-sm';
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-h2">{t('title')}</h1>
        <Link
          href="/admin/orders/new"
          className="flex h-10 items-center rounded-md bg-primary px-4 font-bold text-on-primary"
        >
          {t('newOrder')}
        </Link>
      </div>
      <form className="mt-4 flex flex-wrap items-end gap-2" method="get">
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
        <select
          name="store"
          defaultValue={filters.store ?? ''}
          className={field}
          aria-label={t('allStores')}
        >
          <option value="">{t('allStores')}</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {localized(s, locale)}
            </option>
          ))}
        </select>
        <select
          name="merchant"
          defaultValue={filters.merchant ?? ''}
          className={field}
          aria-label={t('allMerchants')}
        >
          <option value="">{t('allMerchants')}</option>
          {merchants.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <label className="text-caption">
          {t('from')}
          <input
            type="date"
            name="from"
            defaultValue={filters.from ?? ''}
            dir="ltr"
            className={`${field} block`}
          />
        </label>
        <label className="text-caption">
          {t('to')}
          <input
            type="date"
            name="to"
            defaultValue={filters.to ?? ''}
            dir="ltr"
            className={`${field} block`}
          />
        </label>
        <input
          name="q"
          defaultValue={filters.q ?? ''}
          placeholder={t('search')}
          dir="ltr"
          className={`${field} w-48`}
        />
        <label className="flex h-10 items-center gap-2 text-body-sm">
          <input
            type="checkbox"
            name="late"
            value="true"
            defaultChecked={filters.late === 'true'}
          />
          {t('lateOnly')}
        </label>
        <button
          type="submit"
          className="h-10 rounded-md bg-selected-bg px-4 text-body-sm font-bold text-link"
        >
          {t('filter')}
        </button>
      </form>
      <OrdersTable orders={orders} hrefBase="/admin/orders" showMerchant />
    </>
  );
}
