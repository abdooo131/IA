import { getTranslations } from 'next-intl/server';
import { InboxView } from '@/components/hr/leave/InboxView';
import { apiGet } from '@/lib/api-server';
import type { Inbox } from '@/lib/leave-types';

export const dynamic = 'force-dynamic';

/** What waits for HR (and for the person as a manager): leave, attendance fixes, appeals. */
export default async function HrInboxPage() {
  const [inbox, t] = await Promise.all([apiGet<Inbox>('/me/inbox'), getTranslations('hr3')]);
  return (
    <>
      <h1 className="text-h2">{t('inboxTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('inboxIntro')}</p>
      <InboxView inbox={inbox} />
    </>
  );
}
