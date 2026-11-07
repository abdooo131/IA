import { cairoDay, canDo, isMonth, shiftMonth } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { MonthEndChecklistView } from '@/components/finance/MonthEndChecklist';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { MonthEndChecklist } from '@/lib/cash-control-types';

export const dynamic = 'force-dynamic';

/** The month end checklist: live checks with links, hand ticks with a note, then closing. */
export default async function MonthEndPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const q = await searchParams;
  const current = cairoDay(new Date()).slice(0, 7);
  const month = q.month && isMonth(q.month) ? q.month : shiftMonth(current, -1);
  const [list, me, t] = await Promise.all([
    apiGet<MonthEndChecklist>(`/finance/month-end?month=${month}`),
    getMyProfile(),
    getTranslations('cashControl.monthEnd'),
  ]);
  const months = Array.from({ length: 13 }, (_, i) => shiftMonth(current, -i));
  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('intro')}</p>
      <MonthEndChecklistView
        list={list}
        months={months}
        canTick={!!me && canDo(me, 'accounting', 'use')}
        canClose={!!me && canDo(me, 'accounting', 'manage')}
      />
    </>
  );
}
