import { getTranslations } from 'next-intl/server';
import { MyHrFrame } from '@/components/hr/leave/MyHrFrame';
import { MyLeaveView } from '@/components/hr/leave/MyLeaveView';
import { apiGet } from '@/lib/api-server';
import type { MyLeave } from '@/lib/leave-types';

export const dynamic = 'force-dynamic';

/** My leave: balances, asking for leave, and what happened to my requests. */
export default async function MyLeavePage() {
  const [data, t] = await Promise.all([apiGet<MyLeave>('/me/leave'), getTranslations('hr3')]);
  return (
    <MyHrFrame current="/my-file/leave" title={t('myLeaveTitle')} intro={t('myLeaveIntro')}>
      <MyLeaveView data={data} />
    </MyHrFrame>
  );
}
