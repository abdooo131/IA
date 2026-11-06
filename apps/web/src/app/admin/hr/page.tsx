import { canDo, EMPLOYEE_STATUSES } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { StatCard } from '@/components/StatCard';
import { Avatar } from '@/components/hr/Avatar';
import { DocumentAlerts, OpenFileButton } from '@/components/hr/EmployeesActions';
import { StatusChip } from '@/components/hr/StatusChip';
import { type AdminStore, localized } from '@/lib/admin-types';
import { apiGet, getMyProfile } from '@/lib/api-server';
import { isoToDayFirst } from '@/lib/day-first';
import {
  departmentOptions,
  type DepartmentRow,
  type DocumentAlert,
  type EmployeeRow,
  employeeName,
  type GradeRow,
  type PersonWithoutFile,
  type PositionRow,
  titleOf,
} from '@/lib/hr-types';

export const dynamic = 'force-dynamic';

const field = 'h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';
const FILTERS = ['q', 'store', 'department', 'position', 'grade', 'status', 'employment'] as const;

function Completeness({ percent }: { percent: number }) {
  const tone =
    percent === 100
      ? 'bg-status-delivered'
      : percent >= 50
        ? 'bg-status-needs-action'
        : 'bg-danger';
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-pill bg-surface-raised">
        <span className={`block h-full ${tone}`} style={{ width: `${percent}%` }} />
      </span>
      <span className="ltr-iso text-caption">{percent}%</span>
    </span>
  );
}

/**
 * HR's employee directory: quick filters and search (name, mobile, national ID, EMP code),
 * a table or cards, CSV export, documents running out and accounts without a file.
 */
export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Partial<Record<(typeof FILTERS)[number] | 'view', string>>>;
}) {
  const q = await searchParams;
  const params = new URLSearchParams();
  if (q.q) params.set('q', q.q);
  if (q.store) params.set('darkStoreId', q.store);
  if (q.department) params.set('departmentId', q.department);
  if (q.position) params.set('positionId', q.position);
  if (q.grade) params.set('gradeId', q.grade);
  if (q.status) params.set('status', q.status);
  if (q.employment) params.set('employment', q.employment);
  const [rows, stores, departments, positions, grades, alerts, waiting, profile, t, th, locale] =
    await Promise.all([
      apiGet<EmployeeRow[]>(`/hr/employees?${params.toString()}`),
      apiGet<AdminStore[]>('/admin/dark-stores'),
      apiGet<DepartmentRow[]>('/hr/departments'),
      apiGet<PositionRow[]>('/hr/positions'),
      apiGet<GradeRow[]>('/hr/grades'),
      apiGet<DocumentAlert[]>('/hr/alerts'),
      apiGet<PersonWithoutFile[]>('/hr/people-without-file'),
      getMyProfile(),
      getTranslations('people'),
      getTranslations('hr'),
      getLocale(),
    ]);
  const manage = canDo(profile, 'hr', 'manage');
  const cards = q.view === 'cards';
  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const k of [...FILTERS, 'view'] as const) {
      const v = k in patch ? patch[k] : q[k];
      if (v) p.set(k, v);
    }
    const s = p.toString();
    return s ? `/admin/hr?${s}` : '/admin/hr';
  };
  const active = rows.filter((r) => r.status === 'active').length;
  const away = rows.filter((r) => r.status === 'on_leave' || r.status === 'suspended').length;
  const incomplete = rows.filter((r) => r.status !== 'left' && r.documents.percent < 100).length;
  const open = positions.reduce((s, p) => s + (p.isActive ? p.open : 0), 0);
  const th_ = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  const td = 'px-3 py-2 align-middle';
  const name = (x: { nameEn: string; nameAr: string }) => (locale === 'ar' ? x.nameAr : x.nameEn);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-h2">{t('directoryTitle')}</h1>
          <p className="mt-1 max-w-2xl text-body-sm text-text-muted">{t('directoryIntro')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/hr/org"
            className="flex h-10 items-center rounded-md border border-line bg-surface px-4 text-body-sm font-bold"
          >
            {t('orgTitle')}
          </Link>
          <a
            href={`/api/hr/employees.csv?${params.toString()}`}
            className="flex h-10 items-center rounded-md border border-line bg-surface px-4 text-body-sm font-bold"
          >
            {t('exportCsv')}
          </a>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t('statActive')} value={String(active)} tone="delivered" icon="account" />
        <StatCard label={t('statAway')} value={String(away)} tone="needs-action" alert={away > 0} />
        <StatCard
          label={t('statIncomplete')}
          value={String(incomplete)}
          tone="needs-action"
          alert={incomplete > 0}
          hint={t('statIncompleteHint')}
        />
        <StatCard label={t('statOpen')} value={String(open)} tone="new" hint={t('statOpenHint')} />
      </div>

      <DocumentAlerts alerts={alerts} canResolve={canDo(profile, 'hr', 'use')} />

      <form
        method="get"
        className="mt-4 grid gap-2 rounded-lg border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-4"
        aria-label={t('filters')}
      >
        {cards && <input type="hidden" name="view" value="cards" />}
        <label className="block text-caption sm:col-span-2">
          {t('search')}
          <input name="q" defaultValue={q.q} placeholder={t('searchHint')} className={field} />
        </label>
        <label className="block text-caption">
          {t('department')}
          <select name="department" defaultValue={q.department ?? ''} className={field}>
            <option value="">{t('allDepartments')}</option>
            {departmentOptions(departments).map(({ d, depth }) => (
              <option key={d.id} value={d.id}>
                {'  '.repeat(depth)}
                {name(d)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-caption">
          {t('position')}
          <select name="position" defaultValue={q.position ?? ''} className={field}>
            <option value="">{t('allPositions')}</option>
            {positions.map((p) => (
              <option key={p.id} value={p.id}>
                {locale === 'ar' ? p.titleAr : p.titleEn}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-caption">
          {t('grade')}
          <select name="grade" defaultValue={q.grade ?? ''} className={field}>
            <option value="">{t('allGrades')}</option>
            {grades.map((g) => (
              <option key={g.id} value={g.id}>
                {name(g)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-caption">
          {t('store')}
          <select name="store" defaultValue={q.store ?? ''} className={field}>
            <option value="">{t('allStores')}</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {localized(s, locale)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-caption">
          {t('status')}
          <select name="status" defaultValue={q.status ?? ''} className={field}>
            <option value="">{t('allStatuses')}</option>
            {EMPLOYEE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {th(`statuses.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-caption">
          {t('employment')}
          <select name="employment" defaultValue={q.employment ?? ''} className={field}>
            <option value="">{t('allEmployment')}</option>
            <option value="employee">{t('employments.employee')}</option>
            <option value="outsourced">{t('employments.outsourced')}</option>
          </select>
        </label>
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-4">
          <button
            type="submit"
            className="h-10 rounded-md bg-primary px-5 font-bold text-on-primary active:bg-primary-pressed"
          >
            {t('apply')}
          </button>
          <Link
            href={cards ? '/admin/hr?view=cards' : '/admin/hr'}
            className="flex h-10 items-center rounded-md border border-line bg-surface px-4 text-body-sm font-bold"
          >
            {t('clear')}
          </Link>
          <span className="ms-auto flex items-center gap-3">
            <span className="text-caption text-text-muted">
              {t('count', { count: rows.length })}
            </span>
            <span className="flex rounded-md border border-line bg-surface p-0.5" role="group">
              <Link
                href={link({ view: undefined })}
                aria-current={!cards ? 'true' : undefined}
                className={`flex h-9 items-center rounded-sm px-3 text-body-sm font-bold ${!cards ? 'bg-selected-bg text-link' : ''}`}
              >
                {t('viewTable')}
              </Link>
              <Link
                href={link({ view: 'cards' })}
                aria-current={cards ? 'true' : undefined}
                className={`flex h-9 items-center rounded-sm px-3 text-body-sm font-bold ${cards ? 'bg-selected-bg text-link' : ''}`}
              >
                {t('viewCards')}
              </Link>
            </span>
          </span>
        </div>
      </form>

      {rows.length === 0 ? (
        <p className="mt-6 text-body">{t('noOne')}</p>
      ) : cards ? (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((e) => (
            <li key={e.id}>
              <Link
                href={`/admin/hr/${e.id}`}
                className="flex h-full flex-col items-center rounded-lg border border-line bg-surface p-4 text-center shadow-sm hover:border-primary"
              >
                <Avatar employeeId={e.id} photoVersion={e.photoVersion} name={e.nameEn} size="lg" />
                <span className="mt-2 font-bold">{employeeName(e, locale)}</span>
                <span className="text-caption text-text-muted">
                  {(e.position && titleOf(e.position, locale)) ?? e.jobTitle ?? '–'}
                </span>
                <span className="mt-2 flex flex-wrap justify-center gap-1.5">
                  {e.grade && (
                    <span className="rounded-pill bg-selected-bg px-2 text-caption font-bold text-link">
                      {name(e.grade)}
                    </span>
                  )}
                  {e.department && (
                    <span className="rounded-pill bg-surface-raised px-2 text-caption">
                      {name(e.department)}
                    </span>
                  )}
                </span>
                <span className="mt-3 flex w-full items-center justify-between gap-2 border-t border-line pt-3">
                  <StatusChip status={e.status} label={th(`statuses.${e.status}`)} />
                  <Completeness percent={e.documents.percent} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
          <table className="w-full min-w-[960px] text-body-sm">
            <caption className="sr-only">{t('directoryTitle')}</caption>
            <thead className="border-b border-line bg-surface-raised">
              <tr>
                <th scope="col" className={th_}>
                  {t('employee')}
                </th>
                <th scope="col" className={th_}>
                  {t('position')}
                </th>
                <th scope="col" className={th_}>
                  {t('grade')}
                </th>
                <th scope="col" className={th_}>
                  {t('reportsTo')}
                </th>
                <th scope="col" className={th_}>
                  {t('store')}
                </th>
                <th scope="col" className={th_}>
                  {t('hired')}
                </th>
                <th scope="col" className={th_}>
                  {t('documents')}
                </th>
                <th scope="col" className={th_}>
                  {t('status')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((e) => (
                <tr key={e.id} className="hover:bg-surface-raised">
                  <td className={td}>
                    <span className="flex items-center gap-3">
                      <Avatar employeeId={e.id} photoVersion={e.photoVersion} name={e.nameEn} />
                      <span className="min-w-0">
                        <Link href={`/admin/hr/${e.id}`} className="font-bold text-link">
                          {employeeName(e, locale)}
                        </Link>
                        <span className="block text-caption text-text-muted">
                          <span className="ltr-iso">{e.code}</span>
                          {e.mobile && (
                            <>
                              {' · '}
                              <span className="ltr-iso">{e.mobile}</span>
                            </>
                          )}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className={td}>
                    {(e.position && titleOf(e.position, locale)) ?? e.jobTitle ?? '–'}
                    {e.department && (
                      <span className="block text-caption text-text-muted">
                        {name(e.department)}
                      </span>
                    )}
                  </td>
                  <td className={td}>{e.grade ? name(e.grade) : '–'}</td>
                  <td className={td}>{e.manager ? employeeName(e.manager, locale) : '–'}</td>
                  <td className={td}>
                    {e.homeStore ? localized(e.homeStore, locale) : th('office')}
                  </td>
                  <td className={`${td} ltr-iso`}>
                    {e.hireDate ? isoToDayFirst(e.hireDate) : '–'}
                  </td>
                  <td className={td}>
                    <Completeness percent={e.documents.percent} />
                  </td>
                  <td className={td}>
                    <StatusChip status={e.status} label={th(`statuses.${e.status}`)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {waiting.length > 0 && (
        <section className="mt-6 max-w-3xl rounded-lg border border-line bg-surface p-4">
          <h2 className="text-h3">{th('withoutFile')}</h2>
          <p className="mt-1 text-body-sm text-text-muted">{th('withoutFileHint')}</p>
          <ul className="mt-3 divide-y divide-line">
            {waiting.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-bold">{u.name}</span>
                  <span className="ltr-iso block text-caption text-text-muted">{u.email}</span>
                </span>
                {manage && <OpenFileButton userId={u.id} />}
              </li>
            ))}
          </ul>
        </section>
      )}
      {canDo(profile, 'settings', 'manage') && (
        <p className="mt-6 text-body-sm text-text-muted">
          {th('newPersonHint')}{' '}
          <Link href="/admin/users" className="font-bold text-link">
            {th('openUsers')}
          </Link>
        </p>
      )}
    </>
  );
}
