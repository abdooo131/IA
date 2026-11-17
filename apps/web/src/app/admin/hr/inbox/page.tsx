import { getTranslations } from 'next-intl/server';
import { InboxView } from '@/components/hr/leave/InboxView';
import { apiGet } from '@/lib/api-server';
import type { Inbox } from '@/lib/leave-types';
import { HrPageHeader } from '@/components/hr/HrPage';

export const dynamic = 'force-dynamic';

/** What waits for HR (and for the person as a manager): leave, attendance fixes, appeals. */
export default async function HrInboxPage() {
  const [inbox, t] = await Promise.all([apiGet<Inbox>('/me/inbox'), getTranslations('hr3')]);
  return (
    <>
      <HrPageHeader title={t('inboxTitle')} intro={t('inboxIntro')} />
      <InboxView inbox={inbox} />
    </>
  );
}
