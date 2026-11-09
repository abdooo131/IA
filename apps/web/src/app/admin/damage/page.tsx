import { getTranslations } from 'next-intl/server';
import { AppListPage } from '@/components/odoo/AppListPage';

export const dynamic = 'force-dynamic';

/** Damaged units waiting for admin to settle who pays, as a list; each opens its report. */
export default async function AdminDamagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, t] = await Promise.all([searchParams, getTranslations('damage')]);
  return (
    <AppListPage
      list="inventory/damage"
      searchParams={params}
      title={t('title')}
      intro={t('intro')}
    />
  );
}
