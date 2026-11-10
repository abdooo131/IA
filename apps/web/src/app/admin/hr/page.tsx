import { canDo } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DocumentAlerts, OpenFileButton } from '@/components/hr/EmployeesActions';
import { btnPrimary, btnSecondary } from '@/components/hr/HrPage';
import { AppListPage } from '@/components/odoo/AppListPage';
import { apiGet, getMyProfile } from '@/lib/api-server';
import type { DocumentAlert, PersonWithoutFile } from '@/lib/hr-types';
import { legacyListAddress } from '@/lib/legacy-list';

export const dynamic = 'force-dynamic';

/**
 * The employee list as a list view (UX phase C step 4): search by name, EMP number, mobile or
 * email (national ID for HR use only); the file flags, status, employment and pay basis as
 * filters; department (and below), position, grade and store as values; grouping, exports
 * (plus the full CSV of every field) and phone cards. Each row opens the person's file.
 * Document alerts and accounts without a file stay around it.
 */
export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // The HR phase 1 addresses (?flag=, ?status=, ?department=, ?store=, ?grade=) open the state.
  const legacy = legacyListAddress('/admin/hr', params, {
    flag: { filter: true },
    status: { filter: true },
    employment: { filter: true },
    department: { value: 'department' },
    store: { value: 'store' },
    grade: { value: 'grade' },
  });
  if (legacy) redirect(legacy);
  const [alerts, waiting, profile, t, tp, th, tl] = await Promise.all([
    apiGet<DocumentAlert[]>('/hr/alerts'),
    apiGet<PersonWithoutFile[]>('/hr/people-without-file'),
    getMyProfile(),
    getTranslations('hr1'),
    getTranslations('people'),
    getTranslations('hr'),
    getTranslations('appLists.employees'),
  ]);
  const manage = canDo(profile, 'hr', 'manage');
  return (
    <>
      <AppListPage
        list="hr/employees"
        searchParams={params}
        title={t('list.title')}
        intro={tl('intro')}
        toolbar={
          <>
            <Link href="/admin/hr/org" className={btnSecondary}>
              {tp('orgTitle')}
            </Link>
            <a href="/api/hr/employees.csv" className={btnSecondary}>
              {tp('exportCsv')}
            </a>
            {canDo(profile, 'settings', 'manage') && (
              <Link href="/admin/users" className={btnSecondary}>
                {t('list.addPerson')}
              </Link>
            )}
            {canDo(profile, 'hr', 'use') && (
              <Link href="/admin/hr/hire" className={btnPrimary}>
                {th('newHire')}
              </Link>
            )}
          </>
        }
      >
        <DocumentAlerts alerts={alerts} canResolve={canDo(profile, 'hr', 'use')} />
      </AppListPage>

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
