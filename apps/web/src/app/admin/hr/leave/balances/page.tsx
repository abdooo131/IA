import { canDo, cairoDay } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { BalancesView } from '@/components/hr/leave/BalancesView';
import type { AdminStore } from '@/lib/admin-types';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { BalancesReport, LeaveType } from '@/lib/leave-types';

export const dynamic = 'force-dynamic';

const field = 'h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';

/** Leave balances of everyone for a leave year; HR adjusts one with a reason. */
export default async function LeaveBalancesPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; store?: string; department?: string }>;
}) {
  const q = await searchParams;
  const params = new URLSearchParams();
  if (q.year && /^\d{4}$/.test(q.year)) params.set('year', q.year);
  if (q.store) params.set('darkStoreId', q.store);
  if (q.department) params.set('departmentId', q.department);
  const [report, types, stores, departments, profile, t, locale] = await Promise.all([
    apiGet<BalancesReport>(`/hr/leave/balances?${params.toString()}`),
    apiGet<LeaveType[]>('/hr/leave/types'),
    apiGet<AdminStore[]>('/admin/dark-stores'),
    apiGet<{ id: string; nameEn: string; nameAr: string; isActive: boolean }[]>('/hr/departments'),
    getMyProfile(),
    getTranslations('hr3'),
    getLocale(),
  ]);
  const mine = profile?.allStores ? stores : stores.filter((s) => profile?.storeIds.includes(s.id));
  const year = report.year;
  const thisYear = Number(cairoDay(new Date()).slice(0, 4));
  const nav = 'flex h-10 items-center rounded-md border border-line bg-surface px-3 text-body-sm';
  return (
    <>
      <h1 className="text-h2">{t('balancesTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('balancesIntro')}</p>
      <nav className="mt-4 flex items-center gap-2" aria-label={t('year')}>
        <Link href={`/admin/hr/leave/balances?year=${year - 1}`} className={nav}>
          <span className="ltr-iso">{year - 1}</span>
        </Link>
        <span className="ltr-iso text-h3">
          {report.from.split('-').reverse().join('/')} → {report.to.split('-').reverse().join('/')}
        </span>
        {year < thisYear + 1 && (
          <Link href={`/admin/hr/leave/balances?year=${year + 1}`} className={nav}>
            <span className="ltr-iso">{year + 1}</span>
          </Link>
        )}
      </nav>
      <form method="get" className="mt-3 grid gap-2 sm:grid-cols-3" aria-label={t('filters')}>
        <input type="hidden" name="year" value={year} />
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
                {s.code}
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
      <BalancesView report={report} types={types} canUse={canDo(profile, 'hr', 'use')} />
    </>
  );
}
