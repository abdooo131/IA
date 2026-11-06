import { canDo, cairoDay } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { HolidaysManager } from '@/components/hr/HolidaysManager';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { HolidayRow } from '@/lib/attendance-types';

export const dynamic = 'force-dynamic';

/** Official holidays: nobody is absent on them, and work on them is overtime. */
export default async function HolidaysPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const q = await searchParams;
  const year =
    q.year && /^\d{4}$/.test(q.year) ? Number(q.year) : Number(cairoDay(new Date()).slice(0, 4));
  const [holidays, profile, t] = await Promise.all([
    apiGet<HolidayRow[]>(`/hr/holidays?year=${year}`),
    getMyProfile(),
    getTranslations('attendance'),
  ]);
  const nav = 'flex h-10 items-center rounded-md border border-line bg-surface px-3 text-body-sm';
  return (
    <>
      <h1 className="text-h2">{t('holidaysTitle')}</h1>
      <p className="mt-1 max-w-2xl text-body-sm text-text-muted">{t('holidaysIntro')}</p>
      <nav className="mt-4 flex items-center gap-2" aria-label={t('yearNav')}>
        <Link href={`/admin/hr/holidays?year=${year - 1}`} className={nav}>
          <span className="ltr-iso">{year - 1}</span>
        </Link>
        <span className="ltr-iso text-h3">{year}</span>
        <Link href={`/admin/hr/holidays?year=${year + 1}`} className={nav}>
          <span className="ltr-iso">{year + 1}</span>
        </Link>
      </nav>
      <HolidaysManager holidays={holidays} canEdit={canDo(profile, 'hr', 'manage')} />
    </>
  );
}
