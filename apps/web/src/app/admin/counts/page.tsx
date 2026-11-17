import { getTranslations } from 'next-intl/server';
import { AppListPage } from '@/components/odoo/AppListPage';

export const dynamic = 'force-dynamic';

/**
 * Stock counts as a list (UX phase C step 2): it opens on the counts waiting for approval;
 * admin approves several at once (a bin that changed since its count becomes stale and is
 * counted again). Each count opens its document page.
 */
export default async function AdminCountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, t, tl] = await Promise.all([
    searchParams,
    getTranslations('admin.counts'),
    getTranslations('appLists.counts'),
  ]);
  return (
    <AppListPage
      list="inventory/counts"
      searchParams={params}
      title={t('title')}
      intro={tl('intro')}
    />
  );
}
