import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppListPage } from '@/components/odoo/AppListPage';
import { getMyProfile } from '@/lib/api-server';
import { legacyListAddress } from '@/lib/legacy-list';

export const dynamic = 'force-dynamic';

/**
 * Sales > Pipeline > List (UX phase C step 4): every deal the person may see as a list view
 * (a rep with own deals only: theirs). Search by DEAL number, company, contact, phone or email;
 * filters, grouping, fee totals, exports and bulk assign, move and mark lost. The board stays
 * at /admin/sales/pipeline.
 */
export default async function DealsListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // The old filter form's addresses (?ownerId=, ?source=, ?next=none) open the list state.
  const one = (k: string) => (Array.isArray(params[k]) ? params[k][0] : params[k]);
  const legacy = legacyListAddress(
    '/admin/sales/deals',
    {
      ...params,
      next: one('next') === 'none' ? 'no_next_step' : undefined,
      closed: one('closed') === 'hide' ? 'open_deals' : undefined,
    },
    {
      ownerId: { value: 'owner' },
      source: { filter: true },
      next: { filter: true },
      closed: { filter: true },
    },
  );
  if (legacy) redirect(legacy);
  const [profile, t, tl] = await Promise.all([
    getMyProfile(),
    getTranslations('sales'),
    getTranslations('appLists.deals'),
  ]);
  return (
    <AppListPage
      list="sales/deals"
      searchParams={params}
      title={t('list.title')}
      intro={tl('intro')}
      toolbar={
        <>
          <Link href="/admin/sales/pipeline" className="btn-secondary">
            {t('board.boardView')}
          </Link>
          {canDo(profile, 'sales', 'use') && (
            <Link href="/admin/sales/new" className="btn-primary">
              {t('addLead')}
            </Link>
          )}
        </>
      }
    />
  );
}
