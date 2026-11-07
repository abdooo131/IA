import { cairoDay } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import { MyCorrectionsView } from '@/components/hr/leave/MyCorrectionsView';
import { MyHrFrame } from '@/components/hr/leave/MyHrFrame';
import { apiGet } from '@/lib/api-server';
import type { Correction } from '@/lib/leave-types';

export const dynamic = 'force-dynamic';

/** My attendance fixes: ask to correct a day and follow the answer. */
export default async function MyCorrectionsPage() {
  const [rows, t] = await Promise.all([
    apiGet<Correction[]>('/me/corrections'),
    getTranslations('hr3'),
  ]);
  return (
    <MyHrFrame
      current="/my-file/corrections"
      title={t('myCorrectionsTitle')}
      intro={t('myCorrectionsIntro')}
    >
      <MyCorrectionsView rows={rows} today={cairoDay(new Date())} />
    </MyHrFrame>
  );
}
