import { cairoDay, tenure } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { localized } from '@/lib/admin-types';
import { isoToDayFirst } from '@/lib/day-first';
import { type EmployeeFile, employeeName } from '@/lib/hr-types';
import { StatusChip } from './StatusChip';

/** "3 y 4 m", "8 m" or "new" from a hire day. */
export function useTenure() {
  const t = useTranslations('people');
  return (hireDate: string | null) => {
    if (!hireDate) return null;
    const { years, months } = tenure(hireDate, cairoDay(new Date()));
    if (years > 0) return t('tenureYears', { years, months });
    if (months > 0) return t('tenureMonths', { months });
    return t('tenureNew');
  };
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-label uppercase text-text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-body-sm font-bold">{children ?? '–'}</dd>
    </div>
  );
}

/**
 * The top of a file: photo, names in both languages, position, grade, department, manager,
 * status, tenure, store and how complete the documents are. `managerHref` makes the manager a
 * link (HR opens their file).
 */
export function EmployeeHeader({
  file,
  photo,
  managerHref,
  actions,
}: {
  file: EmployeeFile;
  photo: ReactNode;
  managerHref?: (id: string) => string;
  actions?: ReactNode;
}) {
  const t = useTranslations('people');
  const th = useTranslations('hr');
  const locale = useLocale();
  const since = useTenure();
  const other = locale === 'ar' ? file.nameEn : file.nameAr;
  const position =
    (file.position && (locale === 'ar' ? file.position.titleAr : file.position.titleEn)) ??
    file.jobTitle;
  const manager = file.effectiveManager;
  return (
    <section className="rounded-lg border border-line bg-surface p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="shrink-0 self-center sm:self-start">{photo}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-h2">{employeeName(file, locale)}</h1>
            <StatusChip status={file.status} label={th(`statuses.${file.status}`)} />
            {file.employment === 'outsourced' && (
              <span className="rounded-pill border border-line px-2.5 py-0.5 text-caption">
                {t('employments.outsourced')}
              </span>
            )}
          </div>
          {other && (
            <p className="text-body-sm text-text-muted">
              <bdi>{other}</bdi>
            </p>
          )}
          <p className="mt-1 text-body">
            {position ?? <span className="text-text-muted">{t('noPosition')}</span>}
            {file.grade && (
              <span className="ms-2 rounded-pill bg-selected-bg px-2.5 py-0.5 text-caption font-bold text-link">
                {locale === 'ar' ? file.grade.nameAr : file.grade.nameEn}
              </span>
            )}
          </p>
          <p className="mt-1 text-caption text-text-muted">
            <span className="ltr-iso">{file.code}</span>
            {file.user.email && (
              <>
                {' · '}
                <span className="ltr-iso">{file.user.email}</span>
              </>
            )}
            {file.mobile && (
              <>
                {' · '}
                <a href={`tel:${file.mobile}`} className="ltr-iso text-link">
                  {file.mobile}
                </a>
              </>
            )}
          </p>
          {file.status === 'left' && file.leftOn && (
            <p className="mt-1 text-body-sm text-danger">
              {th('leftOnReason', {
                date: isoToDayFirst(file.leftOn),
                reason: file.leftReason ?? '',
              })}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 sm:grid-cols-3 lg:grid-cols-6">
        <Fact label={t('department')}>
          {file.department
            ? locale === 'ar'
              ? file.department.nameAr
              : file.department.nameEn
            : null}
        </Fact>
        <Fact label={t('reportsTo')}>
          {manager ? (
            managerHref ? (
              <Link href={managerHref(manager.id)} className="text-link">
                {employeeName(manager, locale)}
              </Link>
            ) : (
              employeeName(manager, locale)
            )
          ) : null}
        </Fact>
        <Fact label={t('store')}>
          {file.homeStore ? localized(file.homeStore, locale) : th('office')}
        </Fact>
        <Fact label={t('hired')}>
          {file.hireDate ? <span className="ltr-iso">{isoToDayFirst(file.hireDate)}</span> : null}
        </Fact>
        <Fact label={t('tenure')}>{since(file.hireDate)}</Fact>
        {file.completeness ? (
          <Fact label={t('documents')}>
            <span
              className={
                file.completeness.percent === 100
                  ? 'text-status-delivered'
                  : file.completeness.percent >= 50
                    ? 'text-status-needs-action'
                    : 'text-danger'
              }
            >
              {file.completeness.percent}%
            </span>
          </Fact>
        ) : (
          <Fact label={t('contract')}>{th(`contractTypes.${file.contractType}`)}</Fact>
        )}
      </dl>
    </section>
  );
}
