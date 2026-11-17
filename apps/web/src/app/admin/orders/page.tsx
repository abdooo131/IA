import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { AppListPage } from '@/components/odoo/AppListPage';

export const dynamic = 'force-dynamic';

/**
 * Every order as an Odoo style list (UX phase C): search by number, customer, phone or
 * merchant, filters (status, late, payment, source, days, store, merchant), grouping with
 * totals, favourites, exports and bulk accept or cancel.
 */
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, t] = await Promise.all([searchParams, getTranslations('admin.orders')]);
  return (
    <AppListPage
      list="operations/orders"
      searchParams={params}
      title={t('title')}
      toolbar={
        <Link
          href="/admin/orders/new"
          className="flex h-11 shrink-0 items-center rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary"
        >
          {t('newOrder')}
        </Link>
      }
    />
  );
}
