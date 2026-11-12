import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { ProductsToolbar } from '@/components/admin/ProductsManager';
import { AppListPage } from '@/components/odoo/AppListPage';
import { apiGet, getMyProfile } from '@/lib/api-server';
import { legacyListAddress } from '@/lib/legacy-list';

export const dynamic = 'force-dynamic';

/**
 * The merchants' products as a list (UX phase C step 3): search by SKU, barcode or title,
 * filters (active, linked to Shopify, in stock, no barcode), the merchant value, grouping and
 * unit totals; each opens the product's page. New product and the product file import stay
 * above the list.
 */
export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, profile, t, tl] = await Promise.all([
    searchParams,
    getMyProfile(),
    getTranslations('admin.products'),
    getTranslations('appLists.products'),
  ]);
  const legacy = legacyListAddress('/admin/products', params, { merchant: { value: 'merchant' } });
  if (legacy) redirect(legacy);
  const canEdit = canDo(profile, 'merchants', 'use');
  const merchants = canEdit
    ? await apiGet<{ id: string; name: string; isActive: boolean }[]>('/admin/merchants')
    : [];
  return (
    <AppListPage
      list="merchants/products"
      searchParams={params}
      title={t('title')}
      intro={tl('intro')}
      toolbar={canEdit ? <ProductsToolbar merchants={merchants} /> : undefined}
    />
  );
}
