import { canDo, isCalendarDay } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { PayMerchantsRun } from '@/components/finance/PayMerchantsRun';
import { PAY_STEPS, type PayRunData, type PayStep } from '@/lib/pay-run';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { BookAccount } from '@/lib/finance-types';

export const dynamic = 'force-dynamic';

/**
 * The guided Pay merchants run: one page that walks from who is due today to the payouts
 * marked paid. It opens on the step the payouts say is next; any step can be opened.
 */
export default async function PayMerchantsRunPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; cutoff?: string }>;
}) {
  const q = await searchParams;
  const query = q.cutoff && isCalendarDay(q.cutoff) ? `?cutoffDay=${q.cutoff}` : '';
  const [run, accounts, me, t] = await Promise.all([
    apiGet<PayRunData>(`/finance/payouts/run${query}`),
    apiGet<BookAccount[]>('/finance/money-accounts'),
    getMyProfile(),
    getTranslations('finance.payRun'),
  ]);
  const step: PayStep = PAY_STEPS.find((s) => s === q.step) ?? run.current;
  const banks = accounts.filter((a) => a.groupCode === 1100 && a.isActive);
  // A fresh selection whenever the payouts change (after preparing, approving or paying).
  const key = run.drafts.map((d) => `${d.id}:${d.approved ? 1 : 0}`).join(',');
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-h2">{t('title')}</h1>
          <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
        </div>
        <Link href="/finance/payouts" className="text-body-sm font-bold text-link">
          {t('allPayouts')}
        </Link>
      </div>
      <PayMerchantsRun
        key={key}
        run={run}
        step={step}
        banks={banks}
        canWrite={!!me && canDo(me, 'accounting', 'use')}
        canApprove={!!me && canDo(me, 'accounting', 'manage')}
      />
    </>
  );
}
