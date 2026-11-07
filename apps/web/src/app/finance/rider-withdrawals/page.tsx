import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { RiderWithdrawals } from '@/components/finance/RiderWithdrawals';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { WithdrawalList } from '@/lib/rider-wallet';

export const dynamic = 'force-dynamic';

/** Rider pay (CLAUDE.md "Rider pay"): riders' withdrawal requests to approve and pay. */
export default async function RiderWithdrawalsPage() {
  const [list, profile, t] = await Promise.all([
    apiGet<WithdrawalList>('/finance/rider-withdrawals'),
    getMyProfile(),
    getTranslations('riderPay'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('financeTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('financeIntro')}</p>
      <RiderWithdrawals list={list} canUse={canDo(profile, 'accounting', 'use')} />
    </>
  );
}
