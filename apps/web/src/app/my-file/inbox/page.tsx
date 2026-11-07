import { cairoDay } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { InboxView } from '@/components/hr/leave/InboxView';
import { LeaveCalendarGrid } from '@/components/hr/leave/LeaveCalendarGrid';
import { MyHrFrame } from '@/components/hr/leave/MyHrFrame';
import { apiGet } from '@/lib/api-server';
import { shiftMonth } from '@/lib/leave';
import type { Inbox, LeaveCalendar } from '@/lib/leave-types';

export const dynamic = 'force-dynamic';

/**
 * The manager inbox in My HR: what my direct reports ask (leave, attendance fixes) at the first
 * step, the HR step for HR people, and my team's leave calendar.
 */
export default async function MyInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const q = await searchParams;
  const month =
    q.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(q.month) ? q.month : cairoDay(new Date()).slice(0, 7);
  const [inbox, calendar, t] = await Promise.all([
    apiGet<Inbox>('/me/inbox'),
    apiGet<LeaveCalendar>(`/me/team-leave-calendar?month=${month}`),
    getTranslations('hr3'),
  ]);
  const nav = 'flex h-10 items-center rounded-md border border-line bg-surface px-3 text-body-sm';
  return (
    <MyHrFrame current="/my-file/inbox" title={t('inboxTitle')} intro={t('myInboxIntro')}>
      <InboxView inbox={inbox} />
      {inbox.isManager && (
        <section className="mt-6">
          <h2 className="text-h3">{t('teamCalendar')}</h2>
          <div className="mt-2 flex items-center gap-2">
            <Link href={`/my-file/inbox?month=${shiftMonth(month, -1)}`} className={nav}>
              ‹
            </Link>
            <span className="ltr-iso text-body font-bold">{month}</span>
            <Link href={`/my-file/inbox?month=${shiftMonth(month, 1)}`} className={nav}>
              ›
            </Link>
          </div>
          <LeaveCalendarGrid calendar={calendar} />
        </section>
      )}
    </MyHrFrame>
  );
}
