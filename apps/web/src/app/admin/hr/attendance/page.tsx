import { BOARD_STATES } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { AttendancePill } from '@/components/hr/AttendancePill';
import { btnSecondary, EmptyState, HrPageHeader } from '@/components/hr/HrPage';
import { StoreFilter } from '@/components/hr/StoreFilter';
import { type AdminStore, localized } from '@/lib/admin-types';
import { apiGet, getMyProfile } from '@/lib/api-server';
import { type Board, cairoHm, personName } from '@/lib/attendance-types';
import { isoToDayFirst } from '@/lib/day-first';

export const dynamic = 'force-dynamic';

/**
 * Today board (docs/HR.md 2): who is in, late, missing, off or on leave, per store, for both
 * companies; Shiply's couriers clock in by their check in (docs/MERGE.md "One structure").
 */
const TEAMS = ['', 'shiply_now', 'shiply'] as const;
export default async function AttendanceTodayPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string; team?: string }>;
}) {
  const q = await searchParams;
  const [board, stores, profile, t, locale] = await Promise.all([
    apiGet<Board>(
      `/hr/attendance/today?${new URLSearchParams({
        ...(q.store ? { darkStoreId: q.store } : {}),
        ...(q.team ? { team: q.team } : {}),
      })}`,
    ),
    apiGet<AdminStore[]>('/admin/dark-stores'),
    getMyProfile(),
    getTranslations('attendance'),
    getLocale(),
  ]);
  const mine = profile?.allStores ? stores : stores.filter((s) => profile?.storeIds.includes(s.id));
  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  const td = 'px-3 py-2 align-top';
  // Problems first: missing, then late, then the rest in the board's order.
  const order = (s: string) =>
    s === 'missing' ? 0 : s === 'late_in' ? 1 : 2 + BOARD_STATES.indexOf(s as never);
  const people = [...board.people].sort((a, b) => order(a.state) - order(b.state));

  return (
    <>
      <HrPageHeader
        title={t('todayTitle')}
        intro={
          <>
            {t('todayIntro')} <span className="ltr-iso">{isoToDayFirst(board.day)}</span>
          </>
        }
        actions={
          <Link href="/admin/hr/roster" className={btnSecondary}>
            {t('rosterTitle')}
          </Link>
        }
      />
      {board.holiday && (
        <p className="mt-3 rounded-md border border-line bg-surface-raised p-3 text-body-sm">
          {t('holidayToday', {
            name: locale === 'ar' ? board.holiday.nameAr : board.holiday.nameEn,
          })}
        </p>
      )}

      <nav className="mt-4 flex flex-wrap gap-2" aria-label={t('teamLabel')}>
        {TEAMS.map((team) => {
          const params = new URLSearchParams({
            ...(q.store ? { store: q.store } : {}),
            ...(team ? { team } : {}),
          });
          const active = (q.team ?? '') === team;
          return (
            <Link
              key={team || 'all'}
              href={`/admin/hr/attendance${params.size ? `?${params}` : ''}`}
              aria-current={active ? 'page' : undefined}
              className={`rounded-pill border px-3 py-1 text-body-sm font-semibold ${
                active ? 'border-primary bg-selected-bg text-link' : 'border-line bg-surface'
              }`}
            >
              {t(`teams.${team || 'all'}`)}
            </Link>
          );
        })}
      </nav>

      <StoreFilter
        stores={mine.map((s) => ({ id: s.id, label: localized(s, locale) }))}
        value={q.store ?? ''}
        all={profile?.allStores ? t('allStores') : t('myStores')}
      />

      <ul className="mt-4 flex flex-wrap gap-2" aria-label={t('countsLabel')}>
        {BOARD_STATES.filter((s) => board.counts[s]).map((s) => (
          <li key={s}>
            <AttendancePill state={s} label={`${t(`board.${s}`)} · ${board.counts[s]}`} />
          </li>
        ))}
      </ul>

      {people.length === 0 ? (
        <EmptyState
          icon="account"
          title={t('nobody')}
          body={t('nobodyHint')}
          action={{ href: '/admin/hr/roster', label: t('rosterTitle') }}
        />
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
          <table className="w-full min-w-[640px] text-body-sm">
            <caption className="sr-only">{t('todayTitle')}</caption>
            <thead className="border-b border-line bg-surface-raised">
              <tr>
                <th scope="col" className={th}>
                  {t('columns.person')}
                </th>
                <th scope="col" className={th}>
                  {t('columns.shift')}
                </th>
                <th scope="col" className={th}>
                  {t('columns.state')}
                </th>
                <th scope="col" className={th}>
                  {t('columns.in')}
                </th>
                <th scope="col" className={th}>
                  {t('columns.out')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {people.map((p) => (
                <tr key={p.employee.id}>
                  <td className={td}>
                    <Link
                      href={`/admin/hr/attendance/day?employeeId=${p.employee.id}&day=${board.day}`}
                      className="font-bold text-link"
                    >
                      {personName(p.employee, locale)}
                    </Link>
                    <span className="block text-caption text-text-muted">
                      <span className="ltr-iso">{p.employee.code}</span> ·{' '}
                      {p.store ? localized(p.store, locale) : p.hub ? p.hub.name : t('officeName')}
                    </span>
                  </td>
                  <td className={`${td} ltr-iso`}>
                    {p.shift ? `${cairoHm(p.shift.start)} – ${cairoHm(p.shift.end)}` : '–'}
                  </td>
                  <td className={td}>
                    <AttendancePill state={p.state} label={t(`board.${p.state}`)} />
                    {p.state === 'late_in' && (
                      <span className="mt-1 block text-caption text-status-needs-action">
                        {t('lateBy', { minutes: p.lateMinutes })}
                      </span>
                    )}
                    {p.state === 'missing' && (
                      <span className="mt-1 block text-caption text-danger">
                        {t('missingFor', { minutes: p.missingMinutes })}
                      </span>
                    )}
                  </td>
                  <td className={`${td} ltr-iso`}>{cairoHm(p.firstIn)}</td>
                  <td className={`${td} ltr-iso`}>{cairoHm(p.lastOut)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
