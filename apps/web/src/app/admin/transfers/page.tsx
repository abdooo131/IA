import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AppListPage } from '@/components/odoo/AppListPage';
import { getMyProfile } from '@/lib/api-server';
import { legacyListAddress } from '@/lib/legacy-list';

export const dynamic = 'force-dynamic';

/**
 * Transfers between locations as a list (UX phase C step 2): status, sender, receiver, final
 * destination, days, short sent or received; admin approves several drafts at once.
 */
export default async function AdminTransfersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, t, profile] = await Promise.all([
    searchParams,
    getTranslations('transfers'),
    getMyProfile(),
  ]);
  const legacy = legacyListAddress('/admin/transfers', params, { status: { filter: true } });
  if (legacy) redirect(legacy);
  return (
    <AppListPage
      list="inventory/transfers"
      searchParams={params}
      title={t('title')}
      intro={t('intro')}
      toolbar={
        canDo(profile, 'inventory', 'use') ? (
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/transfers/refill"
              className="flex h-10 items-center rounded-md border border-line bg-surface px-4 text-body-sm font-bold"
            >
              {t('refillLink')}
            </Link>
            <Link
              href="/admin/transfers/new"
              className="flex h-10 items-center rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary"
            >
              {t('new')}
            </Link>
          </div>
        ) : undefined
      }
    />
  );
}
