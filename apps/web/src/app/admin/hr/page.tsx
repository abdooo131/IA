import { canDo, DEPARTMENTS, EMPLOYEE_STATUSES } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { DocumentAlerts, OpenFileButton } from '@/components/hr/EmployeesActions';
import { type AdminStore, localized } from '@/lib/admin-types';
import { apiGet, getMyProfile } from '@/lib/api-server';
import { StatusChip } from '@/components/hr/StatusChip';
import { isoToDayFirst } from '@/lib/day-first';
import {
  type DocumentAlert,
  type EmployeeRow,
  employeeName,
  type PersonWithoutFile,
} from '@/lib/hr-types';

export const dynamic = 'force-dynamic';

const field = 'h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';

/** HR: every employee file, with filters, documents about to run out and accounts without a file. */
export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; store?: string; department?: string; status?: string }>;
}) {
  const q = await searchParams;
  const params = new URLSearchParams();
  if (q.q) params.set('q', q.q);
  if (q.store) params.set('darkStoreId', q.store);
  if (q.department) params.set('department', q.department);
  if (q.status) params.set('status', q.status);
  const [rows, stores, alerts, waiting, profile, t, locale] = await Promise.all([
    apiGet<EmployeeRow[]>(`/hr/employees?${params.toString()}`),
    apiGet<AdminStore[]>('/admin/dark-stores'),
    apiGet<DocumentAlert[]>('/hr/alerts'),
    apiGet<PersonWithoutFile[]>('/hr/people-without-file'),
    getMyProfile(),
    getTranslations('hr'),
    getLocale(),
  ]);
  const manage = canDo(profile, 'hr', 'manage');
  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  const td = 'px-3 py-2 align-top';

  return (
    <>
      <h1 className="text-h2">{t('title')}</h1>
      <p className="mt-1 max-w-2xl text-body-sm text-text-muted">{t('intro')}</p>

      <DocumentAlerts alerts={alerts} canResolve={canDo(profile, 'hr', 'use')} />

      <form
        method="get"
        className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5"
        aria-label={t('filters')}
      >
        <label className="block text-caption lg:col-span-2">
          {t('search')}
          <input name="q" defaultValue={q.q} placeholder={t('searchHint')} className={field} />
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
          {t('department')}
          <select name="department" defaultValue={q.department ?? ''} className={field}>
            <option value="">{t('allDepartments')}</option>
            {DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {t(`departments.${d}`)}
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
                {t(`statuses.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-5">
          <button
            type="submit"
            className="h-10 rounded-md bg-primary px-5 font-bold text-on-primary active:bg-primary-pressed"
          >
            {t('apply')}
          </button>
          <Link
            href="/admin/hr"
            className="flex h-10 items-center rounded-md border border-line bg-surface px-4 text-body-sm font-bold"
          >
            {t('clear')}
          </Link>
        </div>
      </form>

      {rows.length === 0 ? (
        <p className="mt-6 text-body">{t('empty')}</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
          <table className="w-full min-w-[720px] text-body-sm">
            <caption className="sr-only">{t('title')}</caption>
            <thead className="border-b border-line bg-surface-raised">
              <tr>
                <th scope="col" className={th}>
                  {t('employee')}
                </th>
                <th scope="col" className={th}>
                  {t('job')}
                </th>
                <th scope="col" className={th}>
                  {t('store')}
                </th>
                <th scope="col" className={th}>
                  {t('hireDate')}
                </th>
                <th scope="col" className={th}>
                  {t('documents')}
                </th>
                <th scope="col" className={th}>
                  {t('status')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className={td}>
                    <Link href={`/admin/hr/${e.id}`} className="font-bold text-link">
                      {employeeName(e, locale)}
                    </Link>
                    <span className="block text-caption text-text-muted">
                      <span className="ltr-iso">{e.code}</span> · {t(`roles.${e.user.role}`)}
                    </span>
                  </td>
                  <td className={td}>
                    {e.jobTitle ?? '–'}
                    {e.department && (
                      <span className="block text-caption text-text-muted">
                        {t(`departments.${e.department}`)}
                      </span>
                    )}
                  </td>
                  <td className={td}>
                    {e.homeStore ? localized(e.homeStore, locale) : t('office')}
                  </td>
                  <td className={`${td} ltr-iso`}>
                    {e.hireDate ? isoToDayFirst(e.hireDate) : '–'}
                  </td>
                  <td className={td}>
                    <span className="ltr-iso">{e.documents}</span>
                    {e.expiredDocuments > 0 && (
                      <span className="ms-2 rounded-pill border border-danger px-2 text-caption text-danger">
                        {t('expiredCount', { count: e.expiredDocuments })}
                      </span>
                    )}
                  </td>
                  <td className={td}>
                    <StatusChip status={e.status} label={t(`statuses.${e.status}`)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {waiting.length > 0 && (
        <section className="mt-6 max-w-3xl rounded-lg border border-line bg-surface p-4">
          <h2 className="text-h3">{t('withoutFile')}</h2>
          <p className="mt-1 text-body-sm text-text-muted">{t('withoutFileHint')}</p>
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
          {t('newPersonHint')}{' '}
          <Link href="/admin/users" className="font-bold text-link">
            {t('openUsers')}
          </Link>
        </p>
      )}
    </>
  );
}
