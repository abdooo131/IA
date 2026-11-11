import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { PayoutChecksEditor } from '@/components/finance/PayoutChecksEditor';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { PayoutCheckRow } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

/** What Accounting ticks on every payout before it is marked paid (accounting manage edits). */
export default async function FinancePayoutChecksPage() {
  const [checks, profile, t] = await Promise.all([
    apiGet<PayoutCheckRow[]>('/finance/payout-checks'),
    getMyProfile(),
    getTranslations('finance.payoutChecks'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-2xl text-body-sm text-text-muted">{t('intro')}</p>
      <PayoutChecksEditor checks={checks} canManage={canDo(profile, 'accounting', 'manage')} />
    </>
  );
}
