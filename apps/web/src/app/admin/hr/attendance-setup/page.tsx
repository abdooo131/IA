import { cairoDay, canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { HolidaysManager } from '@/components/hr/HolidaysManager';
import { HrPageHeader, TabLinks } from '@/components/hr/HrPage';
import { ShiftsManager } from '@/components/hr/ShiftsManager';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { HolidayRow, ShiftRow } from '@/lib/attendance-types';

export const dynamic = 'force-dynamic';

const TABS = ['shifts', 'holidays'] as const;
type Tab = (typeof TABS)[number];

/**
 * One attendance setup page (HR phase 1): shift templates the roster is built from and the
 * official holidays. HR manage changes them. /admin/hr/shifts and /admin/hr/holidays open the
 * right tab here.
 */
export default async function AttendanceSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; year?: string }>;
}) {
  const q = await searchParams;
  const tab: Tab = TABS.includes(q.tab as Tab) ? (q.tab as Tab) : 'shifts';
  const year =
    q.year && /^\d{4}$/.test(q.year) ? Number(q.year) : Number(cairoDay(new Date()).slice(0, 4));
  const [profile, t, ta] = await Promise.all([
    getMyProfile(),
    getTranslations('hr1'),
    getTranslations('attendance'),
  ]);
  const canEdit = canDo(profile, 'hr', 'manage');
  const nav = 'flex h-10 items-center rounded-md border border-line bg-surface px-3 text-body-sm';
  const yearHref = (y: number) => `/admin/hr/attendance-setup?tab=holidays&year=${y}`;
  return (
    <>
      <HrPageHeader title={t('attendanceSetup.title')} intro={t('attendanceSetup.intro')} />
      <TabLinks
        tabs={TABS}
        current={tab}
        href={(k) => `/admin/hr/attendance-setup?tab=${k}`}
        label={(k) => t(`attendanceSetup.tab.${k}`)}
        ariaLabel={t('attendanceSetup.title')}
      />
      {tab === 'shifts' ? (
        <>
          <p className="mt-3 max-w-3xl text-body-sm text-text-muted">{ta('shiftsIntro')}</p>
          <ShiftsManager shifts={await apiGet<ShiftRow[]>('/hr/shifts')} canEdit={canEdit} />
        </>
      ) : (
        <>
          <p className="mt-3 max-w-3xl text-body-sm text-text-muted">{ta('holidaysIntro')}</p>
          <nav className="mt-4 flex items-center gap-2" aria-label={ta('yearNav')}>
            <Link href={yearHref(year - 1)} className={nav}>
              <span className="ltr-iso">{year - 1}</span>
            </Link>
            <span className="ltr-iso text-h3">{year}</span>
            <Link href={yearHref(year + 1)} className={nav}>
              <span className="ltr-iso">{year + 1}</span>
            </Link>
          </nav>
          <HolidaysManager
            holidays={await apiGet<HolidayRow[]>(`/hr/holidays?year=${year}`)}
            canEdit={canEdit}
          />
        </>
      )}
    </>
  );
}
