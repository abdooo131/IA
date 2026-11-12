import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { AppListPage } from '@/components/odoo/AppListPage';
import { legacyListAddress } from '@/lib/legacy-list';

export const dynamic = 'force-dynamic';

/**
 * Stock per store and product as a list (UX phase C step 2): on shelves, reserved and
 * available with the low stock flag, filters, grouping and unit totals; a row opens the
 * product.
 */
export default async function AdminStockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, t] = await Promise.all([searchParams, getTranslations('admin.stock')]);
  const legacy = legacyListAddress('/admin/stock', params, { store: { value: 'store' } });
  if (legacy) redirect(legacy);
  return (
    <AppListPage
      list="inventory/stock"
      searchParams={params}
      title={t('title')}
      intro={t('note')}
    />
  );
}
