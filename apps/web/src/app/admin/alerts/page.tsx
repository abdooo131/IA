import { getTranslations } from 'next-intl/server';
import { AppListPage } from '@/components/odoo/AppListPage';

export const dynamic = 'force-dynamic';

/** What needs attention, as a list (UX phase C): open alerts first, Mark as handled in bulk. */
export default async function AdminAlertsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, t, tl] = await Promise.all([
    searchParams,
    getTranslations('admin.alerts'),
    getTranslations('appLists.alerts'),
  ]);
  return (
    <AppListPage
      list="operations/alerts"
      searchParams={params}
      title={t('title')}
      intro={tl('intro')}
    />
  );
}
