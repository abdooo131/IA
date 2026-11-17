'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { fmtDays, isWeekend } from '@/lib/leave';
import type { LeaveCalendar } from '@/lib/leave-types';
import { day, useName } from './kit';

/**
 * Who is off when: a month grid of people by day (approved leave filled, waiting leave striped,
 * half days marked ½, weekends and holidays shaded). It scrolls sideways inside its box on small
 * screens; phones also get the list of days with the people off.
 */
export function LeaveCalendarGrid({
  calendar,
  hrefBase,
}: {
  calendar: LeaveCalendar;
  hrefBase?: string;
}) {
  const t = useTranslations('hr3');
  const name = useName();
  const holidays = new Set(calendar.holidays);
  if (calendar.people.length === 0)
    return <p className="mt-4 text-body text-text-muted">{t('nobodyOff')}</p>;
  const shade = (d: string) =>
    holidays.has(d) ? 'bg-selected-bg' : isWeekend(d) ? 'bg-surface-raised' : '';
  const byDay = calendar.days
    .map((d) => ({
      day: d,
      people: calendar.people.filter((p) => p.days[d]),
    }))
    .filter((x) => x.people.length > 0);
  return (
    <>
      <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="text-caption">
          <thead>
            <tr>
              <th className="sticky start-0 z-10 min-w-[160px] bg-surface px-3 py-2 text-start">
                {t('person')}
              </th>
              {calendar.days.map((d) => (
                <th
                  key={d}
                  className={`ltr-iso w-8 min-w-8 px-0.5 py-2 text-center font-normal ${shade(d)}`}
                  title={d}
                >
                  {Number(d.slice(8))}
                </th>
              ))}
              <th className="px-3 py-2 text-end">{t('days')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {calendar.people.map((p) => (
              <tr key={p.employee.id}>
                <th
                  scope="row"
                  className="sticky start-0 z-10 bg-surface px-3 py-1.5 text-start font-normal"
                >
                  <span className="block truncate font-bold">{name(p.employee)}</span>
                  <span className="ltr-iso text-text-muted">{p.store ?? t('office')}</span>
                </th>
                {calendar.days.map((d) => {
                  const c = p.days[d];
                  const label = c
                    ? `${name(c.type)}${c.status === 'pending' ? ` (${t('legendPending')})` : ''}`
                    : '';
                  const cell = c ? (
                    <span
                      className={`flex h-6 items-center justify-center rounded-sm text-[11px] font-bold ${
                        c.status === 'approved'
                          ? 'bg-primary text-on-primary'
                          : 'border border-dashed border-primary text-link'
                      }`}
                    >
                      {c.fraction < 1 ? '½' : c.type.code.slice(0, 1).toUpperCase()}
                    </span>
                  ) : null;
                  return (
                    <td key={d} className={`px-0.5 py-1.5 ${shade(d)}`} title={label || undefined}>
                      {c && hrefBase ? (
                        <Link href={`${hrefBase}/${c.requestId}`} aria-label={label}>
                          {cell}
                        </Link>
                      ) : (
                        cell
                      )}
                    </td>
                  );
                })}
                <td className="ltr-iso px-3 py-1.5 text-end">{fmtDays(p.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 flex flex-wrap gap-4 text-caption text-text-muted">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm bg-primary" /> {t('legendApproved')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm border border-dashed border-primary" />{' '}
          {t('legendPending')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm border border-line bg-surface-raised" />{' '}
          {t('legendWeekend')}
        </span>
      </p>
      <ul className="mt-4 grid gap-2 md:hidden">
        {byDay.map((x) => (
          <li key={x.day} className="rounded-lg border border-line bg-surface p-3">
            <p className="font-bold">{day(x.day)}</p>
            <ul className="mt-1 text-body-sm">
              {x.people.map((p) => (
                <li key={p.employee.id}>
                  {name(p.employee)} · {name(p.days[x.day]!.type)}
                  {p.days[x.day]!.status === 'pending' && ` (${t('legendPending')})`}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </>
  );
}
