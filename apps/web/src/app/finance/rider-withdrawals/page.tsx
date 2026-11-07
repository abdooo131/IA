import { getTranslations } from 'next-intl/server';
import { FinanceListPage } from '@/components/odoo/FinanceListPage';

export const dynamic = 'force-dynamic';

/**
 * Rider pay (CLAUDE.md "Rider pay"): riders' withdrawal requests as a list view; each opens
 * its document page to approve, reject or mark paid.
 */
export default async function RiderWithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, t] = await Promise.all([searchParams, getTranslations('riderPay')]);
  return (
    <FinanceListPage
      id="rider_withdrawals"
      searchParams={params}
      title={t('financeTitle')}
      intro={t('financeIntro')}
    />
  );
}
