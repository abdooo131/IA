import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { AppListPage } from '@/components/odoo/AppListPage';
import { legacyListAddress } from '@/lib/legacy-list';

export const dynamic = 'force-dynamic';

/**
 * Shipments in (inbound manifests) as a list (UX phase C step 2): status, store or hub,
 * merchant, days, extra and short units; each opens its document page.
 */
export default async function AdminShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, t, tl] = await Promise.all([
    searchParams,
    getTranslations('admin.shipments'),
    getTranslations('appLists.shipments'),
  ]);
  const legacy = legacyListAddress('/admin/shipments', params, {
    status: { filter: true },
    store: { value: 'store' },
    merchant: { value: 'merchant' },
  });
  if (legacy) redirect(legacy);
  return (
    <AppListPage
      list="inventory/shipments"
      searchParams={params}
      title={t('title')}
      intro={tl('intro')}
    />
  );
}
