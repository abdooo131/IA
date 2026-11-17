import { cairoDay, canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { type BankFile, BankFilePanel } from '@/components/finance/BankFilePanel';
import { PayoutsManager } from '@/components/finance/PayoutsManager';
import { FinanceListPage } from '@/components/odoo/FinanceListPage';
import { apiGet, getMyProfile } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

/** Payouts: prepare what is due, the bank file, then every payout as a list view. */
export default async function FinancePayoutsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, file, profile, t] = await Promise.all([
    searchParams,
    apiGet<BankFile>('/finance/payouts/bank-file'),
    getMyProfile(),
    getTranslations('finance.payouts'),
  ]);
  return (
    <FinanceListPage id="payouts" searchParams={params} title={t('title')} intro={t('intro')}>
      {canDo(profile, 'accounting', 'use') && (
        <PayoutsManager payouts={[]} today={cairoDay(new Date())} onlyPrepare />
      )}
      <BankFilePanel file={file} />
    </FinanceListPage>
  );
}
