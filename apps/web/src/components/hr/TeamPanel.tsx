import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { localized } from '@/lib/admin-types';
import { employeeName, type TeamData, titleOf } from '@/lib/hr-types';
import { Avatar } from './Avatar';
import { StatusChip } from './StatusChip';

/**
 * A manager's team: everyone below them (direct first), with counts by grade and department.
 * `hrefBase` makes names links to their files.
 */
export function TeamPanel({ team, hrefBase }: { team: TeamData; hrefBase: string | null }) {
  const t = useTranslations('people');
  const th = useTranslations('hr');
  const locale = useLocale();
  if (team.total === 0)
    return <p className="mt-4 text-body-sm text-text-muted">{t('teamEmpty')}</p>;
  const grades = new Map(team.people.filter((p) => p.grade).map((p) => [p.grade!.id, p.grade!]));
  const departments = new Map(
    team.people.filter((p) => p.department).map((p) => [p.department!.id, p.department!]),
  );
  const chip = 'rounded-pill border border-line bg-surface px-2.5 py-1 text-caption';
  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="text-label uppercase text-text-muted">{t('direct')}</p>
          <p className="ltr-iso mt-1 text-number-lg">{team.direct}</p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="text-label uppercase text-text-muted">{t('wholeTeam')}</p>
          <p className="ltr-iso mt-1 text-number-lg">{team.total}</p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4 lg:col-span-2">
          <p className="text-label uppercase text-text-muted">{t('byGrade')}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {team.byGrade.map((g) => {
              const grade = grades.get(g.key);
              return (
                <span key={g.key} className={chip}>
                  {grade ? (locale === 'ar' ? grade.nameAr : grade.nameEn) : t('noGrade')}{' '}
                  <b className="ltr-iso">{g.count}</b>
                </span>
              );
            })}
          </div>
          <p className="mt-3 text-label uppercase text-text-muted">{t('byDepartment')}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {team.byDepartment.map((d) => {
              const dept = departments.get(d.key);
              return (
                <span key={d.key} className={chip}>
                  {dept ? (locale === 'ar' ? dept.nameAr : dept.nameEn) : t('noDepartment')}{' '}
                  <b className="ltr-iso">{d.count}</b>
                </span>
              );
            })}
          </div>
        </div>
      </div>
      <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
        {team.people.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 p-3">
            <Avatar employeeId={p.id} photoVersion={p.photoVersion} name={p.nameEn} size="md" />
            <div className="min-w-0 flex-1">
              {hrefBase ? (
                <Link href={`${hrefBase}/${p.id}`} className="font-bold text-link">
                  {employeeName(p, locale)}
                </Link>
              ) : (
                <span className="font-bold">{employeeName(p, locale)}</span>
              )}
              <span className="block truncate text-caption text-text-muted">
                {titleOf(p, locale) ?? '–'}
                {p.department && (
                  <> · {locale === 'ar' ? p.department.nameAr : p.department.nameEn}</>
                )}
                {p.homeStore && <> · {localized(p.homeStore, locale)}</>}
              </span>
            </div>
            {p.grade && (
              <span className="rounded-pill bg-selected-bg px-2.5 py-0.5 text-caption font-bold text-link">
                {locale === 'ar' ? p.grade.nameAr : p.grade.nameEn}
              </span>
            )}
            <span className="rounded-pill bg-surface-raised px-2.5 py-0.5 text-caption">
              {p.level === 1 ? t('direct') : t('levelDown', { level: p.level })}
            </span>
            <StatusChip status={p.status} label={th(`statuses.${p.status}`)} />
          </li>
        ))}
      </ul>
    </div>
  );
}
