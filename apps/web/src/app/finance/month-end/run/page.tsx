import { cairoDay, canDo, isMonth, shiftMonth } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { CloseMonthRun } from '@/components/finance/CloseMonthRun';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { MonthEndChecklist } from '@/lib/cash-control-types';
import { closeStepOf } from '@/lib/close-run';

export const dynamic = 'force-dynamic';

/**
 * The guided Close the month run: the month end checklist one item at a time, with the screen
 * that fixes each, then closing the books (accounting manage). It opens on the first open item.
 */
export default async function CloseMonthRunPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; step?: string }>;
}) {
  const q = await searchParams;
  const current = cairoDay(new Date()).slice(0, 7);
  const month = q.month && isMonth(q.month) ? q.month : shiftMonth(current, -1);
  const [list, me, t] = await Promise.all([
    apiGet<MonthEndChecklist>(`/finance/month-end?month=${month}`),
    getMyProfile(),
    getTranslations('finance.closeRun'),
  ]);
  const months = Array.from({ length: 13 }, (_, i) => shiftMonth(current, -i));
  const step = closeStepOf(list, q.step);
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-h2">{t('title', { month })}</h1>
          <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
        </div>
        <Link
          href={`/finance/month-end?month=${month}`}
          className="text-body-sm font-bold text-link"
        >
          {t('plainList')}
        </Link>
      </div>
      <CloseMonthRun
        key={`${month}:${step}`}
        list={list}
        months={months}
        step={step}
        canTick={!!me && canDo(me, 'accounting', 'use')}
        canClose={!!me && canDo(me, 'accounting', 'manage')}
      />
    </>
  );
}
