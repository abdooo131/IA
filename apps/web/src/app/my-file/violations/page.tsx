import { getTranslations } from 'next-intl/server';
import { MyHrFrame } from '@/components/hr/leave/MyHrFrame';
import { MyViolationsView } from '@/components/hr/leave/MyViolationsView';
import { apiGet } from '@/lib/api-server';
import type { Violation } from '@/lib/leave-types';

export const dynamic = 'force-dynamic';

/** My violations: what was recorded, the penalty, and an appeal within the window. */
export default async function MyViolationsPage() {
  const [data, t] = await Promise.all([
    apiGet<{ appealDays: number; violations: Violation[] }>('/me/violations'),
    getTranslations('hr3'),
  ]);
  return (
    <MyHrFrame
      current="/my-file/violations"
      title={t('myViolationsTitle')}
      intro={t('myViolationsIntro', { days: data.appealDays })}
    >
      <MyViolationsView rows={data.violations} />
    </MyHrFrame>
  );
}
