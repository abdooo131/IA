import { cairoDay } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { LeaveCalendarGrid } from '@/components/hr/leave/LeaveCalendarGrid';
import type { AdminStore } from '@/lib/admin-types';
import { apiGet, getMyProfile } from '@/lib/api-server';
import { shiftMonth } from '@/lib/leave';
import type { LeaveCalendar } from '@/lib/leave-types';

export const dynamic = 'force-dynamic';

const field = 'h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';

/** The team leave calendar: who is off when in a month, by department and store. */
export default async function LeaveCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; store?: string; department?: string }>;
}) {
  const q = await searchParams;
  const month =
    q.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(q.month) ? q.month : cairoDay(new Date()).slice(0, 7);
  const params = new URLSearchParams({ month });
  if (q.store) params.set('darkStoreId', q.store);
  if (q.department) params.set('departmentId', q.department);
  const [calendar, stores, departments, profile, t, locale] = await Promise.all([
    apiGet<LeaveCalendar>(`/hr/leave/calendar?${params.toString()}`),
    apiGet<AdminStore[]>('/admin/dark-stores'),
    apiGet<{ id: string; nameEn: string; nameAr: string; isActive: boolean }[]>('/hr/departments'),
    getMyProfile(),
    getTranslations('hr3'),
    getLocale(),
  ]);
  const mine = profile?.allStores ? stores : stores.filter((s) => profile?.storeIds.includes(s.id));
  const keep = (m: string) => {
    const p = new URLSearchParams({ month: m });
    if (q.store) p.set('store', q.store);
    if (q.department) p.set('department', q.department);
    return `/admin/hr/leave/calendar?${p.toString()}`;
  };
  const nav = 'flex h-10 items-center rounded-md border border-line bg-surface px-3 text-body-sm';
  const label = new Date(`${month}-01T00:00:00Z`).toLocaleDateString(
    locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB',
    { month: 'long', year: 'numeric', timeZone: 'UTC' },
  );
  return (
    <>
      <h1 className="text-h2">{t('calendarTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('calendarIntro')}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link href={keep(shiftMonth(month, -1))} className={nav} aria-label={t('previousMonth')}>
          ‹
        </Link>
        <span className="min-w-36 text-center text-h3">{label}</span>
        <Link href={keep(shiftMonth(month, 1))} className={nav} aria-label={t('nextMonth')}>
          ›
        </Link>
      </div>
      <form method="get" className="mt-3 grid gap-2 sm:grid-cols-3" aria-label={t('filters')}>
        <input type="hidden" name="month" value={month} />
        <label className="block text-caption">
          {t('department')}
          <select name="department" defaultValue={q.department ?? ''} className={field}>
            <option value="">{t('allDepartments')}</option>
            {departments
              .filter((d) => d.isActive)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {locale === 'ar' ? d.nameAr : d.nameEn}
                </option>
              ))}
          </select>
        </label>
        <label className="block text-caption">
          {t('store')}
          <select name="store" defaultValue={q.store ?? ''} className={field}>
            <option value="">{t('allStores')}</option>
            {mine.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {locale === 'ar' ? s.nameAr : s.nameEn}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="h-10 self-end rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary"
        >
          {t('apply')}
        </button>
      </form>
      <LeaveCalendarGrid calendar={calendar} hrefBase="/admin/hr/leave" />
    </>
  );
}
