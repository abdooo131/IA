import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { AppListPage } from '@/components/odoo/AppListPage';
import { getMyProfile } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

/**
 * Basata deposits as a list view (opens on deposits waiting for review): each opens its page
 * with the receipt to approve or reject it. Record Basata transfer books Basata's daily
 * transfer to the bank; Frozen riders lists riders who missed the deposit deadline.
 */
export default async function BasataDepositsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, t, profile] = await Promise.all([
    searchParams,
    getTranslations('basata'),
    getMyProfile(),
  ]);
  const canUse = !!profile && canDo(profile, 'accounting', 'use');
  return (
    <AppListPage
      list="accounting/basata_deposits"
      searchParams={params}
      title={t('title')}
      intro={t('intro')}
      toolbar={
        <div className="flex flex-wrap gap-2">
          {canUse && (
            <Link
              href="/finance/basata/transfer"
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary"
            >
              {t('recordTransfer')}
            </Link>
          )}
          <Link
            href="/finance/frozen-riders"
            className="inline-flex h-10 items-center rounded-md border border-line bg-surface px-4 text-body-sm font-bold text-link"
          >
            {t('frozenRidersLink')}
          </Link>
        </div>
      }
    />
  );
}
