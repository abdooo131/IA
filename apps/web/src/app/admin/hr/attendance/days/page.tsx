import { addDays, ATTENDANCE_STATUSES, cairoDay } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { DateInput } from '@/components/DateInput';
import { AttendancePill } from '@/components/hr/AttendancePill';
import { type AdminStore, localized } from '@/lib/admin-types';
import { apiGet, getMyProfile } from '@/lib/api-server';
import { cairoHm, type DayListRow, hours, personName } from '@/lib/attendance-types';
import { isoToDayFirst } from '@/lib/day-first';
import { EmptyState, HrPageHeader } from '@/components/hr/HrPage';

export const dynamic = 'force-dynamic';

const field = 'h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';

/** Closed attendance days with filters and a CSV export; a row opens the day to correct it. */
export default async function AttendanceDaysPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; store?: string; status?: string }>;
}) {
  const q = await searchParams;
  const today = cairoDay(new Date());
  const to = q.to || addDays(today, -1);
  const from = q.from || addDays(to, -6);
  const params = new URLSearchParams({ from, to });
  if (q.store) params.set('darkStoreId', q.store);
  if (q.status) params.set('status', q.status);
  const [rows, stores, profile, t, locale] = await Promise.all([
    apiGet<DayListRow[]>(`/hr/attendance/days?${params.toString()}`),
    apiGet<AdminStore[]>('/admin/dark-stores'),
    getMyProfile(),
    getTranslations('attendance'),
    getLocale(),
  ]);
  const mine = profile?.allStores ? stores : stores.filter((s) => profile?.storeIds.includes(s.id));
  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  const td = 'px-3 py-2 align-top';

  return (
    <>
      <HrPageHeader title={t('daysTitle')} intro={t('daysIntro')} />

      <form
        method="get"
        className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5"
        aria-label={t('filters')}
      >
        <label className="block text-caption">
          {t('from')}
          <DateInput name="from" defaultValue={from} max={today} />
        </label>
        <label className="block text-caption">
          {t('to')}
          <DateInput name="to" defaultValue={to} max={today} />
        </label>
        <label className="block text-caption">
          {t('store')}
          <select name="store" defaultValue={q.store ?? ''} className={field}>
            <option value="">{profile?.allStores ? t('allStores') : t('myStores')}</option>
            {mine.map((s) => (
              <option key={s.id} value={s.id}>
                {localized(s, locale)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-caption">
          {t('columns.status')}
          <select name="status" defaultValue={q.status ?? ''} className={field}>
            <option value="">{t('allStatuses')}</option>
            {ATTENDANCE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`statuses.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="h-10 rounded-md bg-primary px-5 font-bold text-on-primary active:bg-primary-pressed"
          >
            {t('apply')}
          </button>
          <a
            href={`/api/hr/attendance/days.csv?${params.toString()}`}
            className="flex h-10 items-center rounded-md border border-line bg-surface px-4 text-body-sm font-bold"
          >
            {t('exportCsv')}
          </a>
        </div>
      </form>

      {rows.length === 0 ? (
        <EmptyState icon="schedule" title={t('noDays')} body={t('noDaysHint')} />
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
          <table className="w-full min-w-[760px] text-body-sm">
            <caption className="sr-only">{t('daysTitle')}</caption>
            <thead className="border-b border-line bg-surface-raised">
              <tr>
                <th scope="col" className={th}>
                  {t('columns.day')}
                </th>
                <th scope="col" className={th}>
                  {t('columns.person')}
                </th>
                <th scope="col" className={th}>
                  {t('columns.status')}
                </th>
                <th scope="col" className={th}>
                  {t('columns.shift')}
                </th>
                <th scope="col" className={th}>
                  {t('columns.in')}
                </th>
                <th scope="col" className={th}>
                  {t('columns.out')}
                </th>
                <th scope="col" className={th}>
                  {t('columns.late')}
                </th>
                <th scope="col" className={th}>
                  {t('columns.overtime')}
                </th>
                <th scope="col" className={th}>
                  {t('columns.worked')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className={`${td} ltr-iso`}>
                    <Link
                      href={`/admin/hr/attendance/day?employeeId=${r.employee.id}&day=${r.day}`}
                      className="text-link"
                    >
                      {isoToDayFirst(r.day)}
                    </Link>
                  </td>
                  <td className={td}>
                    <span className="font-bold">{personName(r.employee, locale)}</span>
                    <span className="block text-caption text-text-muted">
                      <span className="ltr-iso">{r.employee.code}</span> ·{' '}
                      {r.store ? localized(r.store, locale) : t('officeName')}
                    </span>
                  </td>
                  <td className={td}>
                    <AttendancePill state={r.status} label={t(`statuses.${r.status}`)} />
                    {r.flags.map((f) => (
                      <span key={f} className="mt-1 block text-caption text-text-muted">
                        {t(`flags.${f}`)}
                      </span>
                    ))}
                  </td>
                  <td className={`${td} ltr-iso`}>
                    {r.plannedStart ? `${cairoHm(r.plannedStart)} – ${cairoHm(r.plannedEnd)}` : '–'}
                  </td>
                  <td className={`${td} ltr-iso`}>{cairoHm(r.firstIn)}</td>
                  <td className={`${td} ltr-iso`}>{cairoHm(r.lastOut)}</td>
                  <td className={`${td} ltr-iso`}>{r.lateMinutes || '–'}</td>
                  <td className={`${td} ltr-iso`}>{r.overtimeMinutes || '–'}</td>
                  <td className={`${td} ltr-iso`}>{hours(r.workedMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
