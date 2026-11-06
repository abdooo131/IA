import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { apiGet } from '@/lib/api-server';
import { isoToDayFirst } from '@/lib/day-first';
import { employeeCodeOf, employeeName, type OpenChecklistRow } from '@/lib/hr-types';

export const dynamic = 'force-dynamic';

/** Onboarding and offboarding checklists still open across the company, late ones first. */
export default async function HrChecklistsPage() {
  const [rows, t, locale] = await Promise.all([
    apiGet<OpenChecklistRow[]>('/hr/checklists/open'),
    getTranslations('people'),
    getLocale(),
  ]);
  const sorted = [...rows].sort(
    (a, b) => b.overdue - a.overdue || a.startsOn.localeCompare(b.startsOn),
  );
  return (
    <>
      <h1 className="text-h2">{t('checklistsTitle')}</h1>
      <p className="mt-1 max-w-3xl text-body-sm text-text-muted">{t('checklistsIntro')}</p>
      {sorted.length === 0 ? (
        <p className="mt-6 text-body">{t('openEmpty')}</p>
      ) : (
        <ul className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((c) => {
            const percent = c.total ? Math.round((c.done / c.total) * 100) : 100;
            return (
              <li key={c.id}>
                <Link
                  href={`/admin/hr/${c.employee.id}?tab=checklists`}
                  className="block h-full rounded-lg border border-line bg-surface p-4 shadow-sm hover:border-primary"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-bold">{employeeName(c.employee, locale)}</span>
                    <span className="rounded-pill bg-surface-raised px-2 text-caption">
                      {t(`checklistKinds.${c.kind}`)}
                    </span>
                  </span>
                  <span className="mt-1 block text-caption text-text-muted">
                    <span className="ltr-iso">{employeeCodeOf(c.employee.number)}</span> ·{' '}
                    {locale === 'ar' ? c.nameAr : c.nameEn} ·{' '}
                    {t('startsOn', { date: isoToDayFirst(c.startsOn) })}
                  </span>
                  <span className="mt-3 flex items-center gap-2">
                    <span className="h-2 flex-1 overflow-hidden rounded-pill bg-surface-raised">
                      <span className="block h-full bg-primary" style={{ width: `${percent}%` }} />
                    </span>
                    <span className="ltr-iso text-caption font-bold">
                      {c.done}/{c.total}
                    </span>
                  </span>
                  {c.overdue > 0 && (
                    <span className="mt-2 block text-caption font-bold text-danger">
                      {t('lateTasks', { count: c.overdue })}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
