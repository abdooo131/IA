import { canDo, type DirectorySort, EMPLOYEE_FLAGS, EMPLOYEE_STATUSES } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { Avatar } from '@/components/hr/Avatar';
import { DocumentAlerts, OpenFileButton } from '@/components/hr/EmployeesActions';
import { FlagChip } from '@/components/hr/FlagChip';
import { btnPrimary, btnSecondary, EmptyState, HrPageHeader } from '@/components/hr/HrPage';
import { StatusChip } from '@/components/hr/StatusChip';
import { type AdminStore, localized } from '@/lib/admin-types';
import { apiGet, getMyProfile } from '@/lib/api-server';
import { isoToDayFirst } from '@/lib/day-first';
import type { Directory, DirectoryRow } from '@/lib/hr-overview-types';
import { directoryQuery, LIST_KEYS, listHref, type ListQuery, sortHref } from '@/lib/hr-phase1';
import {
  departmentOptions,
  type DepartmentRow,
  type DocumentAlert,
  employeeName,
  type PersonWithoutFile,
  titleOf,
} from '@/lib/hr-types';

export const dynamic = 'force-dynamic';

const field = 'h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';

/**
 * The employee list (HR phase 1): photo or initials, name, EMP number, position, department,
 * store, employment and status with coloured flags; quick search (name, EMP, mobile), filters,
 * sort by column, pages and CSV. Phones get one card per person.
 */
export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<ListQuery>;
}) {
  const raw = await searchParams;
  const q: ListQuery = {};
  for (const k of LIST_KEYS) if (typeof raw[k] === 'string' && raw[k]) q[k] = raw[k];
  const [data, stores, departments, alerts, waiting, profile, t, tp, th, locale] =
    await Promise.all([
      apiGet<Directory>(`/hr/directory?${directoryQuery(q)}`),
      apiGet<AdminStore[]>('/admin/dark-stores'),
      apiGet<DepartmentRow[]>('/hr/departments'),
      apiGet<DocumentAlert[]>('/hr/alerts'),
      apiGet<PersonWithoutFile[]>('/hr/people-without-file'),
      getMyProfile(),
      getTranslations('hr1'),
      getTranslations('people'),
      getTranslations('hr'),
      getLocale(),
    ]);
  const manage = canDo(profile, 'hr', 'manage');
  const mine = profile?.allStores ? stores : stores.filter((s) => profile?.storeIds.includes(s.id));
  const name = (x: { nameEn: string; nameAr: string }) => (locale === 'ar' ? x.nameAr : x.nameEn);
  const filtered = LIST_KEYS.some((k) => k !== 'sort' && k !== 'dir' && k !== 'page' && q[k]);
  const position = (e: DirectoryRow) =>
    (e.position && titleOf(e.position, locale)) ?? e.jobTitle ?? '–';
  const store = (e: DirectoryRow) => (e.homeStore ? localized(e.homeStore, locale) : th('office'));
  const flags = (e: DirectoryRow) =>
    e.flags.length > 0 && (
      <span className="flex flex-wrap gap-1">
        {e.flags.map((f) => (
          <FlagChip key={f} flag={f} label={t(`flags.${f}`)} />
        ))}
      </span>
    );
  const sortable = (sort: DirectorySort, label: string) => {
    const active = (q.sort ?? 'name') === sort;
    return (
      <th
        scope="col"
        aria-sort={active ? (q.dir === 'desc' ? 'descending' : 'ascending') : undefined}
        className="px-3 py-2 text-start text-label uppercase text-text-muted"
      >
        <Link href={sortHref(q, sort)} className={active ? 'text-link' : 'hover:text-text'}>
          {label}
          {active && <span aria-hidden="true">{q.dir === 'desc' ? ' ↓' : ' ↑'}</span>}
        </Link>
      </th>
    );
  };
  const th_ = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  const td = 'px-3 py-2 align-middle';

  return (
    <>
      <HrPageHeader
        title={t('list.title')}
        intro={t('list.intro')}
        actions={
          <>
            <Link href="/admin/hr/org" className={btnSecondary}>
              {tp('orgTitle')}
            </Link>
            <a
              href={`/api/hr/employees.csv?${directoryQuery(q, { page: false })}`}
              className={btnSecondary}
            >
              {tp('exportCsv')}
            </a>
            {canDo(profile, 'settings', 'manage') && (
              <Link href="/admin/users" className={btnPrimary}>
                {t('list.addPerson')}
              </Link>
            )}
          </>
        }
      />

      <DocumentAlerts alerts={alerts} canResolve={canDo(profile, 'hr', 'use')} />

      <form
        method="get"
        className="mt-4 grid gap-2 rounded-lg border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-6"
        aria-label={tp('filters')}
      >
        {q.sort && <input type="hidden" name="sort" value={q.sort} />}
        {q.dir && <input type="hidden" name="dir" value={q.dir} />}
        <label className="block text-caption sm:col-span-2">
          {t('list.search')}
          <input
            name="q"
            type="search"
            defaultValue={q.q}
            placeholder={t('list.searchHint')}
            className={field}
          />
        </label>
        <label className="block text-caption">
          {tp('department')}
          <select name="department" defaultValue={q.department ?? ''} className={field}>
            <option value="">{tp('allDepartments')}</option>
            {departmentOptions(departments).map(({ d, depth }) => (
              <option key={d.id} value={d.id}>
                {'  '.repeat(depth)}
                {name(d)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-caption">
          {tp('store')}
          <select name="store" defaultValue={q.store ?? ''} className={field}>
            <option value="">{profile?.allStores ? tp('allStores') : t('list.myStores')}</option>
            {mine.map((s) => (
              <option key={s.id} value={s.id}>
                {localized(s, locale)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-caption">
          {tp('status')}
          <select name="status" defaultValue={q.status ?? ''} className={field}>
            <option value="">{tp('allStatuses')}</option>
            {EMPLOYEE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {th(`statuses.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-caption">
          {tp('employment')}
          <select name="employment" defaultValue={q.employment ?? ''} className={field}>
            <option value="">{tp('allEmployment')}</option>
            <option value="employee">{tp('employments.employee')}</option>
            <option value="outsourced">{tp('employments.outsourced')}</option>
          </select>
        </label>
        <label className="block text-caption sm:col-span-2 lg:col-span-2">
          {t('list.flag')}
          <select name="flag" defaultValue={q.flag ?? ''} className={field}>
            <option value="">{t('list.anyFlag')}</option>
            {EMPLOYEE_FLAGS.map((f) => (
              <option key={f} value={f}>
                {t(`flags.${f}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-4">
          <button type="submit" className={btnPrimary}>
            {tp('apply')}
          </button>
          {filtered && (
            <Link href="/admin/hr" className={btnSecondary}>
              {tp('clear')}
            </Link>
          )}
          <span className="ms-auto text-caption text-text-muted">
            {tp('count', { count: data.total })}
          </span>
        </div>
      </form>

      <ul className="mt-3 flex flex-wrap gap-2" aria-label={t('list.flagsLabel')}>
        {EMPLOYEE_FLAGS.filter((f) => data.flagCounts[f] || q.flag === f).map((f) => (
          <li key={f}>
            <Link
              href={listHref(q, { flag: q.flag === f ? undefined : f })}
              aria-current={q.flag === f ? 'true' : undefined}
              className={`inline-flex h-9 items-center gap-1.5 rounded-pill border px-3 text-caption font-bold ${
                q.flag === f ? 'border-primary bg-selected-bg text-link' : 'border-line bg-surface'
              }`}
            >
              {t(`flags.${f}`)}
              <span className="ltr-iso">{data.flagCounts[f] ?? 0}</span>
            </Link>
          </li>
        ))}
      </ul>

      {data.total === 0 ? (
        filtered ? (
          <EmptyState
            icon="search"
            title={t('list.noMatch')}
            body={t('list.noMatchHint')}
            action={{ href: '/admin/hr', label: tp('clear') }}
          />
        ) : (
          <EmptyState
            icon="account"
            title={t('list.empty')}
            body={t('list.emptyHint')}
            action={
              canDo(profile, 'settings', 'manage')
                ? { href: '/admin/users', label: t('list.addPerson') }
                : undefined
            }
          />
        )
      ) : (
        <>
          {/* Phones: one card per person. */}
          <ul className="mt-3 space-y-2 lg:hidden">
            {data.rows.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/admin/hr/${e.id}`}
                  className="flex gap-3 rounded-lg border border-line bg-surface p-3 shadow-sm"
                >
                  <Avatar
                    employeeId={e.id}
                    photoVersion={e.photoVersion}
                    name={e.nameEn}
                    size="md"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate font-bold text-link">
                          {employeeName(e, locale)}
                        </span>
                        <span className="ltr-iso block text-caption text-text-muted">{e.code}</span>
                      </span>
                      <StatusChip status={e.status} label={th(`statuses.${e.status}`)} />
                    </span>
                    <span className="mt-1 block truncate text-body-sm">{position(e)}</span>
                    <span className="block truncate text-caption text-text-muted">
                      {[e.department ? name(e.department) : null, store(e)]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    {e.flags.length > 0 && <span className="mt-2 block">{flags(e)}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {/* Desktop: a table, sortable by column. */}
          <div className="mt-3 hidden overflow-x-auto rounded-lg border border-line bg-surface shadow-sm lg:block">
            <table className="w-full text-body-sm">
              <caption className="sr-only">{t('list.title')}</caption>
              <thead className="border-b border-line bg-surface-raised">
                <tr>
                  {sortable('name', tp('employee'))}
                  <th scope="col" className={th_}>
                    {tp('position')}
                  </th>
                  {sortable('department', tp('department'))}
                  {sortable('store', tp('store'))}
                  {sortable('hired', tp('hired'))}
                  <th scope="col" className={th_}>
                    {tp('employment')}
                  </th>
                  <th scope="col" className={th_}>
                    {tp('status')}
                  </th>
                  <th scope="col" className={th_}>
                    {t('list.flagsColumn')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.map((e) => (
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
                    <td className={td}>{position(e)}</td>
                    <td className={td}>{e.department ? name(e.department) : '–'}</td>
                    <td className={td}>{store(e)}</td>
                    <td className={`${td} ltr-iso`}>
                      {e.hireDate ? isoToDayFirst(e.hireDate) : '–'}
                    </td>
                    <td className={td}>{tp(`employments.${e.employment}`)}</td>
                    <td className={td}>
                      <StatusChip status={e.status} label={th(`statuses.${e.status}`)} />
                    </td>
                    <td className={td}>{flags(e) || <span className="text-text-muted">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.pages > 1 && (
            <nav
              className="mt-3 flex flex-wrap items-center justify-between gap-2"
              aria-label={t('list.pages')}
            >
              {data.page > 1 ? (
                <Link href={listHref(q, { page: String(data.page - 1) })} className={btnSecondary}>
                  {t('list.previous')}
                </Link>
              ) : (
                <span />
              )}
              <span className="text-caption text-text-muted">
                {t('list.pageOf', { page: data.page, pages: data.pages })}
              </span>
              {data.page < data.pages ? (
                <Link href={listHref(q, { page: String(data.page + 1) })} className={btnSecondary}>
                  {t('list.next')}
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}

      {waiting.length > 0 && (
        <section className="mt-6 max-w-3xl rounded-lg border border-line bg-surface p-4">
          <h2 className="text-h3">{th('withoutFile')}</h2>
          <p className="mt-1 text-body-sm text-text-muted">{th('withoutFileHint')}</p>
          <ul className="mt-3 divide-y divide-line">
            {waiting.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="font-bold">{u.name}</span>
                  <span className="ltr-iso block break-all text-caption text-text-muted">
                    {u.email}
                  </span>
                </span>
                {manage && <OpenFileButton userId={u.id} />}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
