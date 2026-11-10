import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { AppListPage } from '@/components/odoo/AppListPage';
import { legacyListAddress } from '@/lib/legacy-list';

export const dynamic = 'force-dynamic';

/** Returns to merchants as a list (UX phase C step 2); each opens its document page. */
export default async function AdminReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, t, tl] = await Promise.all([
    searchParams,
    getTranslations('returns'),
    getTranslations('appLists.returns'),
  ]);
  const legacy = legacyListAddress('/admin/returns', params, { status: { filter: true } });
  if (legacy) redirect(legacy);
  return (
    <AppListPage
      list="inventory/returns"
      searchParams={params}
      title={t('title')}
      intro={tl('intro')}
    />
  );
}
