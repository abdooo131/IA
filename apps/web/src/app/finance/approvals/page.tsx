import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { FinanceListPage } from '@/components/odoo/FinanceListPage';
import { apiGet, getMyProfile } from '@/lib/api-server';
import { formatEgp } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * What waits for a second person: money movements as a list view with bulk approve and
 * reject (each still checked by the server), and a link to payouts waiting for approval.
 */
export default async function FinanceApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, controls, profile, t] = await Promise.all([
    searchParams,
    apiGet<{ approvalThresholdPiastres: number; payoutsToApprove: number }>('/finance/controls'),
    getMyProfile(),
    getTranslations('finance.approvals'),
  ]);
  return (
    <FinanceListPage
      id="approvals"
      searchParams={params}
      title={t('title')}
      intro={t('intro', { amount: formatEgp(controls.approvalThresholdPiastres) })}
    >
      {controls.payoutsToApprove > 0 && canDo(profile, 'accounting', 'manage') && (
        <p className="mt-4 rounded-lg border border-status-needs-action bg-surface p-3 text-body-sm">
          <Link href="/finance/payouts?f=for_me_to_approve" className="font-bold text-link">
            {t('payoutsWaiting', { count: controls.payoutsToApprove })}
          </Link>
        </p>
      )}
    </FinanceListPage>
  );
}
