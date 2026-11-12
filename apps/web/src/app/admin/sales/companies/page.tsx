import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { AppListPage } from '@/components/odoo/AppListPage';
import { getMyProfile } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

/**
 * Sales > Companies (UX phase C step 4): every brand we talk to as a list view (a rep with own
 * deals only: theirs), with owner, contacts, open and won deals and the merchant once won.
 */
export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, profile, t, tl] = await Promise.all([
    searchParams,
    getMyProfile(),
    getTranslations('sales'),
    getTranslations('appLists.companies'),
  ]);
  return (
    <AppListPage
      list="sales/companies"
      searchParams={params}
      title={t('companies.title')}
      intro={tl('intro')}
      toolbar={
        canDo(profile, 'sales', 'use') ? (
          <Link href="/admin/sales/new" className="btn-primary">
            {t('addLead')}
          </Link>
        ) : undefined
      }
    />
  );
}
