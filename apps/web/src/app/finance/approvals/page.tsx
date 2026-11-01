import { getTranslations } from 'next-intl/server';
import { Approvals } from '@/components/finance/Approvals';
import { apiGet } from '@/lib/api-server';
import type { FinanceRequestRow, PayoutRow } from '@/lib/finance-types';
import { formatEgp } from '@/lib/format';
import { getCurrentUser } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

export default async function FinanceApprovalsPage() {
  const [pending, all, payouts, controls, me, t] = await Promise.all([
    apiGet<FinanceRequestRow[]>('/finance/requests?status=pending'),
    apiGet<FinanceRequestRow[]>('/finance/requests'),
    apiGet<PayoutRow[]>('/finance/payouts?status=draft'),
    apiGet<{ approvalThresholdPiastres: number }>('/finance/controls'),
    getCurrentUser(),
    getTranslations('finance.approvals'),
  ]);
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">
        {t('intro', { amount: formatEgp(controls.approvalThresholdPiastres) })}
      </p>
      <Approvals
        requests={pending}
        payouts={payouts.filter((p) => p.needsApproval)}
        decided={all.filter((r) => r.status !== 'pending').slice(0, 20)}
        meId={me?.id ?? ''}
      />
    </>
  );
}
