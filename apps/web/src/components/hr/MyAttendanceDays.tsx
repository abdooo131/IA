'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { AttendancePill } from '@/components/hr/AttendancePill';
import { cairoHm, hours, type MyAttendance } from '@/lib/attendance-types';
import { isoToDayFirst } from '@/lib/day-first';

const shiftMonth = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};

/** My HR: the person's own closed attendance days, one month at a time (read only). */
export function MyAttendanceDays() {
  const t = useTranslations('attendance');
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<MyAttendance | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const query = month ? `?month=${month}` : '';
    fetch(`/api/me/attendance${query}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) return setFailed(true);
        const body = (await res.json()) as MyAttendance;
        setData(body);
        if (!month) setMonth(body.month);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [month]);

  if (failed) return null;
  const th = 'px-3 py-2 text-start text-label uppercase text-text-muted';
  const td = 'px-3 py-2 align-top';
  return (
    <section className="mt-6" aria-labelledby="my-days">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="my-days" className="text-h3">
          {t('myDays')}
        </h2>
        {month && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMonth(shiftMonth(month, -1))}
              className="h-10 rounded-md border border-line px-3 text-body-sm"
            >
              {t('previousMonth')}
            </button>
            <span className="ltr-iso text-body-sm font-bold">{month}</span>
            <button
              type="button"
              onClick={() => setMonth(shiftMonth(month, 1))}
              className="h-10 rounded-md border border-line px-3 text-body-sm"
            >
              {t('nextMonth')}
            </button>
          </div>
        )}
      </div>
      {!data ? null : data.days.length === 0 ? (
        <p className="mt-3 text-body-sm text-text-muted">{t('noDays')}</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[520px] text-body-sm">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>{t('columns.day')}</th>
                <th className={th}>{t('columns.status')}</th>
                <th className={th}>{t('columns.in')}</th>
                <th className={th}>{t('columns.out')}</th>
                <th className={th}>{t('columns.late')}</th>
                <th className={th}>{t('columns.worked')}</th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((d) => (
                <tr key={d.day} className="border-b border-line last:border-0">
                  <td className={`${td} ltr-iso`}>{isoToDayFirst(d.day)}</td>
                  <td className={td}>
                    <AttendancePill state={d.status} label={t(`statuses.${d.status}`)} />
                    {d.flags.includes('forgot_clock_out') && (
                      <span className="ms-1 text-caption text-status-needs-action">
                        {t('flags.forgot_clock_out')}
                      </span>
                    )}
                  </td>
                  <td className={`${td} ltr-iso`}>{cairoHm(d.firstIn)}</td>
                  <td className={`${td} ltr-iso`}>{cairoHm(d.lastOut)}</td>
                  <td className={`${td} ltr-iso`}>{d.lateMinutes || '–'}</td>
                  <td className={`${td} ltr-iso`}>{hours(d.workedMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
