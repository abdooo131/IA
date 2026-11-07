'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cairoClock, fmtDays } from '@/lib/leave';
import type { Correction, Inbox, LeaveRequest } from '@/lib/leave-types';
import { Decision } from './Decision';
import { day, panel, useName } from './kit';
import { PenaltyText } from './ViolationsTable';

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className={panel}>
      <h2 className="flex items-center gap-2 text-h3">
        {title}
        <span className="ltr-iso rounded-pill bg-selected-bg px-2 text-caption text-link">
          {count}
        </span>
      </h2>
      {children}
    </section>
  );
}

/**
 * Everything waiting for the person: as a manager, their direct reports' leave and attendance
 * fixes (first step); with HR use, the HR step; with HR manage, appeals; and the suggested
 * violations to look at. Each item carries its own buttons.
 */
export function InboxView({ inbox }: { inbox: Inbox }) {
  const t = useTranslations('hr3');
  const name = useName();
  const leaveLine = (r: LeaveRequest) => (
    <>
      <p className="font-bold">
        {name(r.employee)}{' '}
        <span className="ltr-iso text-caption font-normal text-text-muted">{r.number}</span>
      </p>
      <p className="text-body-sm">
        {name(r.type)} · {t('daysCount', { days: fmtDays(r.days) })} · {day(r.from)}
        {r.from !== r.to && <> → {day(r.to)}</>}
      </p>
      {r.note && <p className="text-caption text-text-muted">{r.note}</p>}
      {r.documentNeeded && !r.hasDocument && (
        <p className="text-caption text-status-needs-action">{t('documentMissing')}</p>
      )}
    </>
  );
  const correctionLine = (c: Correction) => (
    <>
      <p className="font-bold">
        {name(c.employee)}{' '}
        <span className="ltr-iso text-caption font-normal text-text-muted">{c.number}</span>
      </p>
      <p className="text-body-sm">
        {day(c.day)} · {c.problem}
      </p>
      <p className="ltr-iso text-caption text-text-muted">
        {cairoClock(c.proposedIn) || '–'} → {cairoClock(c.proposedOut) || '–'}
      </p>
    </>
  );
  const item = 'rounded-lg border border-line p-3';
  if (inbox.total === 0 && inbox.suggestions === 0)
    return <p className="mt-4 text-body text-text-muted">{t('inboxEmpty')}</p>;
  return (
    <div>
      {inbox.manager.leave.length + inbox.manager.corrections.length > 0 && (
        <Group
          title={t('asManager')}
          count={inbox.manager.leave.length + inbox.manager.corrections.length}
        >
          <ul className="mt-3 grid gap-2 lg:grid-cols-2">
            {inbox.manager.leave.map((r) => (
              <li key={r.id} className={item}>
                <span className="text-caption font-bold text-link">{t('kindLeave')}</span>
                {leaveLine(r)}
                <Decision
                  compact
                  approvePath={`/me/inbox/leave/${r.id}/approve`}
                  rejectPath={`/me/inbox/leave/${r.id}/reject`}
                />
              </li>
            ))}
            {inbox.manager.corrections.map((c) => (
              <li key={c.id} className={item}>
                <span className="text-caption font-bold text-link">{t('kindCorrection')}</span>
                {correctionLine(c)}
                <Decision
                  compact
                  approvePath={`/me/inbox/corrections/${c.id}/approve`}
                  rejectPath={`/me/inbox/corrections/${c.id}/reject`}
                />
              </li>
            ))}
          </ul>
        </Group>
      )}
      {inbox.hr.use && inbox.hrStep.leave.length + inbox.hrStep.corrections.length > 0 && (
        <Group
          title={t('asHr')}
          count={inbox.hrStep.leave.length + inbox.hrStep.corrections.length}
        >
          <ul className="mt-3 grid gap-2 lg:grid-cols-2">
            {inbox.hrStep.leave.map((r) => (
              <li key={r.id} className={item}>
                <Link href={`/admin/hr/leave/${r.id}`} className="text-caption font-bold text-link">
                  {t('kindLeave')}
                </Link>
                {leaveLine(r)}
                <Decision
                  compact
                  approvePath={`/hr/leave/requests/${r.id}/approve`}
                  rejectPath={`/hr/leave/requests/${r.id}/reject`}
                />
              </li>
            ))}
            {inbox.hrStep.corrections.map((c) => (
              <li key={c.id} className={item}>
                <Link
                  href={`/admin/hr/attendance/day?employeeId=${c.employee.id}&day=${c.day}`}
                  className="text-caption font-bold text-link"
                >
                  {t('kindCorrection')}
                </Link>
                {correctionLine(c)}
                <Decision
                  compact
                  approvePath={`/hr/corrections/${c.id}/apply`}
                  approveLabel={t('apply')}
                  rejectPath={`/hr/corrections/${c.id}/reject`}
                />
              </li>
            ))}
          </ul>
        </Group>
      )}
      {inbox.appeals.length > 0 && (
        <Group title={t('appeals')} count={inbox.appeals.length}>
          <ul className="mt-3 grid gap-2 lg:grid-cols-2">
            {inbox.appeals.map((a) => (
              <li key={a.id} className={item}>
                <Link href={`/admin/hr/violations/${a.id}`} className="ltr-iso font-bold text-link">
                  {a.number}
                </Link>
                <p className="font-bold">{name(a.employee)}</p>
                <p className="text-body-sm">
                  {name({ nameEn: a.type.nameEn, nameAr: a.type.nameAr })} · {day(a.occurredOn)} ·{' '}
                  <PenaltyText p={a} />
                </p>
                <p className="text-caption text-text-muted">{a.appealReason}</p>
              </li>
            ))}
          </ul>
        </Group>
      )}
      {inbox.hr.use && inbox.suggestions > 0 && (
        <section className={panel}>
          <Link href="/admin/hr/violations/suggested" className="font-bold text-link">
            {t('suggestionsWaiting', { count: inbox.suggestions })}
          </Link>
        </section>
      )}
    </div>
  );
}
