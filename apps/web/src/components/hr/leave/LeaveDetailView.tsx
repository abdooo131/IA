'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { fmtDays } from '@/lib/leave';
import type { LeaveRequestDetail } from '@/lib/leave-types';
import { Decision } from './Decision';
import { day, panel, StatePill, useName } from './kit';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="break-words text-body-sm">{children ?? '–'}</dd>
    </div>
  );
}

/**
 * A leave request as HR (mode hr) or the person's manager (mode team) sees it: the facts, the
 * balance it draws on, the trail of decisions, the days and what they may do next.
 */
export function LeaveDetailView({
  request: r,
  mode,
  canUse,
  documentPath,
}: {
  request: LeaveRequestDetail;
  mode: 'hr' | 'team';
  canUse: boolean;
  documentPath: string;
}) {
  const t = useTranslations('hr3');
  const name = useName();
  const waiting = r.status === 'pending_manager' || r.status === 'pending_hr';
  const inPayroll = r.dayRows.some((d) => d.inPayroll);
  const unpaid = r.dayRows.filter((d) => !d.paid).length;
  const b = r.balance.line ?? null;
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="min-w-0">
        <section className={panel.replace('mt-4 ', '')}>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Row label={t('type')}>
              {name(r.type)} {!r.type.paid && `· ${t('unpaid')}`}
            </Row>
            <Row label={t('status')}>
              <StatePill status={r.status} />
            </Row>
            <Row label={t('dates')}>
              {day(r.from)} → {day(r.to)} {r.halfDay && `(${t('halfDay')})`}
            </Row>
            <Row label={t('days')}>
              <span className="ltr-iso">{fmtDays(r.days)}</span>
              {unpaid > 0 && (
                <span className="ms-2 text-caption text-status-needs-action">
                  {t('unpaidDays', { days: unpaid })}
                </span>
              )}
            </Row>
            <Row label={t('person')}>
              {name(r.employee)} <span className="ltr-iso text-caption">{r.employee.code}</span>
            </Row>
            <Row label={t('store')}>{r.employee.store?.code ?? t('office')}</Row>
            <Row label={t('manager')}>{r.manager ? name(r.manager) : t('noManager')}</Row>
            <Row label={t('requestedBy')}>
              {r.requestedBy}
              {r.onBehalf && ` · ${t('onBehalf')}`}
            </Row>
            <Row label={t('note')}>{r.note}</Row>
            <Row label={t('document')}>
              {r.hasDocument ? (
                <a href={documentPath} target="_blank" rel="noreferrer" className="text-link">
                  {r.documentName ?? t('openDocument')}
                </a>
              ) : r.documentNeeded ? (
                <span className="text-status-needs-action">{t('documentMissing')}</span>
              ) : (
                t('notNeeded')
              )}
            </Row>
            {r.rejectReason && <Row label={t('rejectReason')}>{r.rejectReason}</Row>}
            {r.cancelReason && <Row label={t('cancelReason')}>{r.cancelReason}</Row>}
          </dl>
          {mode === 'hr' && canUse && (
            <Decision
              approvePath={
                r.status === 'pending_hr' ? `/hr/leave/requests/${r.id}/approve` : undefined
              }
              rejectPath={waiting ? `/hr/leave/requests/${r.id}/reject` : undefined}
              cancelPath={
                waiting || (r.status === 'approved' && !inPayroll)
                  ? `/hr/leave/requests/${r.id}/cancel`
                  : undefined
              }
              cancelNeedsReason={r.status === 'approved'}
              uploadPath={waiting ? `/hr/leave/requests/${r.id}/document` : undefined}
              uploadLabel={t('attachNote')}
            />
          )}
          {mode === 'hr' && r.status === 'pending_manager' && (
            <p className="mt-2 text-caption text-text-muted">
              {t('waitsForManager', { name: r.managerNow ? name(r.managerNow) : '–' })}
            </p>
          )}
        </section>

        <section className={panel}>
          <h2 className="text-h3">{t('daysTitle')}</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {r.dayRows.map((d) => (
              <li
                key={d.day}
                className={`rounded-md border px-2 py-1 text-caption ${d.paid ? 'border-line' : 'border-status-needs-action text-status-needs-action'}`}
              >
                {day(d.day)}
                {d.fraction < 1 && ' ½'}
                {!d.paid && ` · ${t('unpaid')}`}
                {d.inPayroll && ` · ${t('inPayroll')}`}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <aside className="min-w-0">
        <section className={panel.replace('mt-4 ', '')}>
          <h2 className="text-h3">{t('balanceTitle', { year: r.balance.year })}</h2>
          {r.balance.annual && (
            <dl className="mt-2 grid grid-cols-2 gap-2 text-body-sm">
              <dt className="text-text-muted">{t('entitlement')}</dt>
              <dd className="ltr-iso text-end">{fmtDays(r.balance.annual.entitlement)}</dd>
              <dt className="text-text-muted">{t('carriedIn')}</dt>
              <dd className="ltr-iso text-end">{fmtDays(r.balance.annual.carriedIn)}</dd>
              <dt className="text-text-muted">{t('adjustments')}</dt>
              <dd className="ltr-iso text-end">{fmtDays(r.balance.annual.adjustments)}</dd>
              <dt className="text-text-muted">{t('taken')}</dt>
              <dd className="ltr-iso text-end">{fmtDays(r.balance.annual.taken)}</dd>
              <dt className="text-text-muted">{t('pending')}</dt>
              <dd className="ltr-iso text-end">{fmtDays(r.balance.annual.pending)}</dd>
              <dt className="font-bold">{t('remaining')}</dt>
              <dd className="ltr-iso text-end font-bold">{fmtDays(r.balance.annual.remaining)}</dd>
            </dl>
          )}
          {b && b.entitlement !== null && (
            <p className="mt-3 text-body-sm">
              {t('typeBalance', {
                type: name(b.type),
                taken: fmtDays(b.taken),
                of: fmtDays(b.entitlement),
              })}
            </p>
          )}
          {!r.balance.annual && (!b || b.entitlement === null) && (
            <p className="mt-2 text-body-sm text-text-muted">{t('noBalanceHint')}</p>
          )}
        </section>
        <section className={panel}>
          <h2 className="text-h3">{t('trail')}</h2>
          <ol className="mt-2 grid gap-1 text-body-sm">
            <li>{t('trailAsked', { name: r.requestedBy ?? '–' })}</li>
            {r.managerDecidedBy && r.status !== 'rejected' && (
              <li>{t('trailManager', { name: r.managerDecidedBy })}</li>
            )}
            {r.hrDecidedBy && r.status === 'approved' && (
              <li>{t('trailHr', { name: r.hrDecidedBy })}</li>
            )}
            {r.rejectedBy && <li>{t('trailRejected', { name: r.rejectedBy })}</li>}
            {r.cancelledBy && <li>{t('trailCancelled', { name: r.cancelledBy })}</li>}
          </ol>
        </section>
      </aside>
    </div>
  );
}
