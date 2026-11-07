import { addDays, canDo, cairoDay, isCalendarDay } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { RosterGrid } from '@/components/hr/RosterGrid';
import { StoreFilter } from '@/components/hr/StoreFilter';
import { type AdminStore, localized } from '@/lib/admin-types';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { Roster } from '@/lib/attendance-types';
import { isoToDayFirst } from '@/lib/day-first';
import { HrPageHeader } from '@/components/hr/HrPage';

export const dynamic = 'force-dynamic';

const OFFICE = 'office';

/** The weekly roster of one store (or the office), Saturday to Friday, editable per day. */
export default async function RosterPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string; week?: string }>;
}) {
  const q = await searchParams;
  const [stores, profile, t, locale] = await Promise.all([
    apiGet<AdminStore[]>('/admin/dark-stores'),
    getMyProfile(),
    getTranslations('attendance'),
    getLocale(),
  ]);
  const mine = profile?.allStores ? stores : stores.filter((s) => profile?.storeIds.includes(s.id));
  const store = q.store || mine[0]?.id || OFFICE;
  const week = q.week && isCalendarDay(q.week) ? q.week : cairoDay(new Date());
  const params = new URLSearchParams({ week });
  if (store !== OFFICE) params.set('darkStoreId', store);
  const roster = await apiGet<Roster>(`/hr/roster?${params.toString()}`);
  const link = (w: string) => `/admin/hr/roster?store=${store}&week=${w}`;

  return (
    <>
      <HrPageHeader title={t('rosterTitle')} intro={t('rosterIntro')} />
      <StoreFilter
        stores={mine.map((s) => ({ id: s.id, label: localized(s, locale) }))}
        value={store}
        all={null}
        extra={profile?.allStores ? [{ id: OFFICE, label: t('officeName') }] : []}
      />
      <nav className="mt-4 flex flex-wrap items-center gap-2" aria-label={t('weekNav')}>
        <Link
          href={link(addDays(roster.from, -7))}
          className="flex h-10 items-center rounded-md border border-line bg-surface px-3 text-body-sm"
        >
          {t('previousWeek')}
        </Link>
        <span className="ltr-iso text-body-sm font-bold">
          {isoToDayFirst(roster.days[0]!)} – {isoToDayFirst(roster.days[6]!)}
        </span>
        <Link
          href={link(addDays(roster.from, 7))}
          className="flex h-10 items-center rounded-md border border-line bg-surface px-3 text-body-sm"
        >
          {t('nextWeek')}
        </Link>
      </nav>
      <RosterGrid
        roster={roster}
        storeId={store === OFFICE ? null : store}
        canEdit={canDo(profile, 'hr', 'use')}
      />
    </>
  );
}
