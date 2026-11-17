import { canDo, isCalendarDay } from '@shiplynow/shared';
import { getLocale, getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AttendancePill } from '@/components/hr/AttendancePill';
import { DayCorrections } from '@/components/hr/DayCorrections';
import { apiGet, getMyProfile } from '@/lib/api-server';
import { cairoHm, type DayDetail, hours, personName } from '@/lib/attendance-types';
import { isoToDayFirst } from '@/lib/day-first';

export const dynamic = 'force-dynamic';

/** One person's day: the plan, the punches and the status, with the manager's corrections. */
export default async function AttendanceDayPage({
  searchParams,
}: {
  searchParams: Promise<{ employeeId?: string; day?: string }>;
}) {
  const q = await searchParams;
  if (!q.employeeId || !q.day || !isCalendarDay(q.day)) notFound();
  const [detail, profile, t, locale] = await Promise.all([
    apiGet<DayDetail>(`/hr/attendance/day?employeeId=${q.employeeId}&day=${q.day}`),
    getMyProfile(),
    getTranslations('attendance'),
    getLocale(),
  ]);
  const status = detail.row?.status ?? detail.preview.status;
  const box = 'mt-4 rounded-lg border border-line bg-surface p-4';
  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  const td = 'px-3 py-2 align-top';

  return (
    <>
      <Link href="/admin/hr/attendance/days" className="text-body-sm text-link">
        {t('backToDays')}
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-h2">{personName(detail.employee, locale)}</h1>
        <AttendancePill state={status} label={t(`statuses.${status}`)} />
      </div>
      <p className="mt-1 text-body-sm text-text-muted">
        <span className="ltr-iso">{detail.employee.code}</span> ·{' '}
        <span className="ltr-iso">{isoToDayFirst(detail.day)}</span> ·{' '}
        {detail.closed ? t('closed') : t('notClosed')}
      </p>

      <section className={box} aria-labelledby="day-plan">
        <h2 id="day-plan" className="text-h3">
          {t('plan')}
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <dt className="text-caption text-text-muted">{t('columns.shift')}</dt>
            <dd className="ltr-iso text-body-sm">
              {detail.holiday
                ? t('holiday')
                : detail.plan
                  ? `${cairoHm(detail.plan.start)} – ${cairoHm(detail.plan.end)}`
                  : detail.dayOff
                    ? t('dayOff')
                    : t('noShift')}
            </dd>
          </div>
          <div>
            <dt className="text-caption text-text-muted">{t('columns.late')}</dt>
            <dd className="ltr-iso text-body-sm">{detail.row?.lateMinutes ?? '–'}</dd>
          </div>
          <div>
            <dt className="text-caption text-text-muted">{t('columns.overtime')}</dt>
            <dd className="ltr-iso text-body-sm">{detail.row?.overtimeMinutes ?? '–'}</dd>
          </div>
          <div>
            <dt className="text-caption text-text-muted">{t('columns.worked')}</dt>
            <dd className="ltr-iso text-body-sm">
              {hours(detail.row?.workedMinutes ?? detail.preview.workedMinutes)}
            </dd>
          </div>
        </dl>
        {detail.row?.overrideStatus && (
          <p className="mt-3 text-body-sm">
            {t('correctedFrom', {
              computed: t(`statuses.${detail.row.computedStatus}`),
              reason: detail.row.correctionReason ?? '',
            })}
          </p>
        )}
        {detail.row?.flags.includes('forgot_clock_out') && (
          <p className="mt-2 text-body-sm text-status-needs-action">
            {t('flags.forgot_clock_out')}
          </p>
        )}
      </section>

      <section className="mt-6" aria-labelledby="day-punches">
        <h2 id="day-punches" className="text-h3">
          {t('punches')}
        </h2>
        {detail.punches.length === 0 ? (
          <p className="mt-2 text-body-sm text-text-muted">{t('noPunches')}</p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full min-w-[560px] text-body-sm">
              <thead className="border-b border-line bg-surface-raised">
                <tr>
                  <th scope="col" className={th}>
                    {t('columns.time')}
                  </th>
                  <th scope="col" className={th}>
                    {t('columns.kind')}
                  </th>
                  <th scope="col" className={th}>
                    {t('columns.source')}
                  </th>
                  <th scope="col" className={th}>
                    {t('columns.distance')}
                  </th>
                  <th scope="col" className={th}>
                    {t('columns.note')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {detail.punches.map((p) => (
                  <tr key={p.id} className={p.voided ? 'text-text-muted line-through' : ''}>
                    <td className={`${td} ltr-iso`}>{cairoHm(p.at)}</td>
                    <td className={td}>{t(`kinds.${p.kind}`)}</td>
                    <td className={td}>{t(`sources.${p.source}`)}</td>
                    <td className={`${td} ltr-iso`}>
                      {p.distanceM === null ? '–' : `${p.distanceM} m (±${p.accuracyM ?? '?'} m)`}
                    </td>
                    <td className={td}>{p.voided ? p.voidReason : (p.reason ?? '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canDo(profile, 'hr', 'use') && detail.canCorrect && <DayCorrections detail={detail} />}
    </>
  );
}
