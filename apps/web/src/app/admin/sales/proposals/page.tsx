import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { AppListPage } from '@/components/odoo/AppListPage';
import { legacyListAddress } from '@/lib/legacy-list';

export const dynamic = 'force-dynamic';

/**
 * Sales > Proposals (UX phase C step 4): every proposal the person may see as a list view, by
 * status, owner and month, with the discounts waiting for a sales manager. Each opens its deal.
 */
export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // The old tabs (?status=, ?approval=1) open the list state.
  const legacy = legacyListAddress(
    '/admin/sales/proposals',
    { ...params, approval: params.approval === '1' ? 'to_approve' : undefined },
    { status: { filter: true }, approval: { filter: true } },
  );
  if (legacy) redirect(legacy);
  const [t, tl] = await Promise.all([
    getTranslations('sales.proposals'),
    getTranslations('appLists.proposals'),
  ]);
  return (
    <AppListPage
      list="sales/proposals"
      searchParams={params}
      title={t('listTitle')}
      intro={tl('intro')}
    />
  );
}
