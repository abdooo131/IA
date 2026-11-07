import { CHECKLIST_STATES } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { StateChip } from '@/components/hr/DocumentsPanel';
import { apiGet } from '@/lib/api-server';
import { isoToDayFirst } from '@/lib/day-first';
import {
  departmentOptions,
  type DepartmentRow,
  type DocumentTypeRow,
  employeeCodeOf,
  employeeName,
  type MissingDocumentRow,
  type PendingDocument,
} from '@/lib/hr-types';
import { HrPageHeader } from '@/components/hr/HrPage';

export const dynamic = 'force-dynamic';
const field = 'h-10 w-full rounded-md border border-line bg-surface px-3 text-body-sm text-text';

/**
 * Documents across the company: what people sent themselves and waits for HR, and every
 * required document not in order (missing, refused, expired or running out), with CSV.
 */
export default async function HrDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ department?: string; type?: string; state?: string }>;
}) {
  const q = await searchParams;
  const params = new URLSearchParams();
  if (q.department) params.set('departmentId', q.department);
  if (q.type) params.set('typeId', q.type);
  if (q.state) params.set('state', q.state);
  const [pending, missing, departments, types, t, locale] = await Promise.all([
    apiGet<PendingDocument[]>('/hr/documents/pending'),
    apiGet<MissingDocumentRow[]>(`/hr/documents/missing?${params.toString()}`),
    apiGet<DepartmentRow[]>('/hr/departments'),
    apiGet<DocumentTypeRow[]>('/hr/document-types'),
    getTranslations('people'),
    getLocale(),
  ]);
  const name = (x: { nameEn: string; nameAr: string }) => (locale === 'ar' ? x.nameAr : x.nameEn);
  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  const people = new Set(missing.map((m) => m.employee.id)).size;
  return (
    <>
      <HrPageHeader title={t('docsTitle')} intro={t('docsIntro')} />

      <section className="mt-4 rounded-lg border border-line bg-surface" aria-labelledby="pending">
        <h2 id="pending" className="border-b border-line p-4 text-h3">
          {t('pendingTitle')} <span className="ltr-iso text-text-muted">({pending.length})</span>
        </h2>
        {pending.length === 0 ? (
          <p className="p-4 text-body-sm text-text-muted">{t('pendingEmpty')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {pending.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span className="min-w-0">
                  <Link
                    href={`/admin/hr/${d.employee.id}?tab=documents`}
                    className="font-bold text-link"
                  >
                    {employeeName(d.employee, locale)}
                  </Link>
                  <span className="block text-caption text-text-muted">
                    {name(d.type)} · {t('version', { n: d.version })} ·{' '}
                    {isoToDayFirst(d.createdAt.slice(0, 10))}
                  </span>
                </span>
                <Link
                  href={`/admin/hr/${d.employee.id}?tab=documents`}
                  className="flex h-9 items-center rounded-md border border-line px-3 text-body-sm font-bold"
                >
                  {t('review')}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6" aria-labelledby="missing">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="missing" className="text-h3">
            {t('missingTitle')}
          </h2>
          <a
            href={`/api/hr/documents/missing.csv?${params.toString()}`}
            className="flex h-10 items-center rounded-md border border-line bg-surface px-4 text-body-sm font-bold"
          >
            {t('exportCsv')}
          </a>
        </div>
        <form method="get" className="mt-3 grid gap-2 sm:grid-cols-4" aria-label={t('filters')}>
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
            {t('documentType')}
            <select name="type" defaultValue={q.type ?? ''} className={field}>
              <option value="">{t('allTypes')}</option>
              {types
                .filter((x) => x.isActive)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {name(x)}
                  </option>
                ))}
            </select>
          </label>
          <label className="block text-caption">
            {t('state')}
            <select name="state" defaultValue={q.state ?? ''} className={field}>
              <option value="">{t('allStates')}</option>
              {CHECKLIST_STATES.filter((s) => s !== 'verified').map((s) => (
                <option key={s} value={s}>
                  {t(`states.${s}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="h-10 rounded-md bg-primary px-5 font-bold text-on-primary"
            >
              {t('apply')}
            </button>
            <Link
              href="/admin/hr/documents"
              className="flex h-10 items-center rounded-md border border-line bg-surface px-4 text-body-sm font-bold"
            >
              {t('clear')}
            </Link>
          </div>
        </form>
        <p className="mt-2 text-caption text-text-muted">
          {t('missingSummary', { rows: missing.length, people })}
        </p>
        {missing.length === 0 ? (
          <p className="mt-3 text-body-sm">{t('missingEmpty')}</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full min-w-[640px] text-body-sm">
              <thead className="border-b border-line bg-surface-raised">
                <tr>
                  <th className={th}>{t('employee')}</th>
                  <th className={th}>{t('department')}</th>
                  <th className={th}>{t('documentType')}</th>
                  <th className={th}>{t('state')}</th>
                  <th className={th}>{t('expiresOn')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {missing.map((m) => (
                  <tr key={`${m.employee.id}-${m.type.id}`}>
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/hr/${m.employee.id}?tab=documents`}
                        className="font-bold text-link"
                      >
                        {employeeName(m.employee, locale)}
                      </Link>
                      <span className="ltr-iso block text-caption text-text-muted">
                        {employeeCodeOf(m.employee.number)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {m.employee.department ? name(m.employee.department) : '–'}
                    </td>
                    <td className="px-3 py-2">{name(m.type)}</td>
                    <td className="px-3 py-2">
                      <StateChip state={m.state} />
                    </td>
                    <td className="ltr-iso px-3 py-2">
                      {m.expiresOn ? isoToDayFirst(m.expiresOn) : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
