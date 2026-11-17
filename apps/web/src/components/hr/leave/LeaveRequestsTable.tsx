'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { fmtDays } from '@/lib/leave';
import type { LeaveRequest } from '@/lib/leave-types';
import { day, StatePill, td, th, useName } from './kit';

/**
 * Leave requests as a table on wide screens and cards on phones. The number opens a request (HR's
 * detail page under `hrefBase`, or none in My HR where `actions` gives each row its buttons).
 */
export function LeaveRequestsTable({
  rows,
  hrefBase,
  showPerson = true,
  actions,
}: {
  rows: LeaveRequest[];
  hrefBase?: string;
  showPerson?: boolean;
  actions?: (r: LeaveRequest) => React.ReactNode;
}) {
  const t = useTranslations('hr3');
  const name = useName();
  if (rows.length === 0) return <p className="mt-4 text-body text-text-muted">{t('noRequests')}</p>;
  const number = (r: LeaveRequest) =>
    hrefBase ? (
      <Link href={`${hrefBase}/${r.id}`} className="ltr-iso font-bold text-link">
        {r.number}
      </Link>
    ) : (
      <span className="ltr-iso font-bold">{r.number}</span>
    );
  const dates = (r: LeaveRequest) =>
    r.from === r.to ? (
      day(r.from)
    ) : (
      <>
        {day(r.from)} → {day(r.to)}
      </>
    );
  return (
    <>
      <div className="mt-4 hidden overflow-x-auto rounded-lg border border-line bg-surface md:block">
        <table className="w-full text-body-sm">
          <thead>
            <tr>
              <th className={th}>{t('number')}</th>
              {showPerson && <th className={th}>{t('person')}</th>}
              <th className={th}>{t('type')}</th>
              <th className={th}>{t('dates')}</th>
              <th className={`${th} text-end`}>{t('days')}</th>
              <th className={th}>{t('status')}</th>
              {actions && <th className={th} />}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={td}>{number(r)}</td>
                {showPerson && (
                  <td className={td}>
                    <span className="block font-bold">{name(r.employee)}</span>
                    <span className="ltr-iso text-caption text-text-muted">
                      {r.employee.code}
                      {r.employee.store ? ` · ${r.employee.store.code}` : ''}
                    </span>
                  </td>
                )}
                <td className={td}>
                  {name(r.type)}
                  {r.halfDay && <span className="block text-caption">{t('halfDay')}</span>}
                </td>
                <td className={td}>{dates(r)}</td>
                <td className={`${td} ltr-iso text-end`}>{fmtDays(r.days)}</td>
                <td className={td}>
                  <StatePill status={r.status} />
                  {r.documentNeeded && !r.hasDocument && r.status.startsWith('pending') && (
                    <span className="mt-1 block text-caption text-status-needs-action">
                      {t('documentMissing')}
                    </span>
                  )}
                </td>
                {actions && <td className={`${td} text-end`}>{actions(r)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-4 grid gap-2 md:hidden">
        {rows.map((r) => (
          <li key={r.id} className="rounded-lg border border-line bg-surface p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {number(r)}
              <StatePill status={r.status} />
            </div>
            {showPerson && <p className="mt-1 font-bold">{name(r.employee)}</p>}
            <p className="mt-1 text-body-sm">
              {name(r.type)} · {t('daysCount', { days: fmtDays(r.days) })}
            </p>
            <p className="text-body-sm text-text-muted">{dates(r)}</p>
            {r.documentNeeded && !r.hasDocument && r.status.startsWith('pending') && (
              <p className="text-caption text-status-needs-action">{t('documentMissing')}</p>
            )}
            {actions && <div className="mt-2">{actions(r)}</div>}
          </li>
        ))}
      </ul>
    </>
  );
}
