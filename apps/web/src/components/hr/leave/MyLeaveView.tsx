'use client';

import { useTranslations } from 'next-intl';
import { fmtDays, leftText } from '@/lib/leave';
import type { MyLeave } from '@/lib/leave-types';
import { Decision } from './Decision';
import { Section, useName } from './kit';
import { LeaveRequestForm } from './LeaveRequestForm';
import { LeaveRequestsTable } from './LeaveRequestsTable';

/** My HR leave: my balances this leave year, a request form and my requests. */
export function MyLeaveView({ data }: { data: MyLeave }) {
  const t = useTranslations('hr3');
  const name = useName();
  const b = data.balances;
  const card = 'min-w-0 rounded-lg border border-line bg-surface p-4';
  const others = b.types.filter(
    (x) =>
      x.type.isActive &&
      !(x.type.balance === 'annual' && x.entitlement === null) &&
      (x.entitlement !== null || x.taken > 0 || x.pending > 0),
  );
  return (
    <>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className={`${card} sm:col-span-2`}>
          <p className="text-caption text-text-muted">{t('annualLeft', { year: b.year })}</p>
          <p className="ltr-iso text-h1 font-bold">{leftText(b.annual.available)}</p>
          <p className="text-caption text-text-muted">
            {t('annualLine', {
              entitlement: fmtDays(b.annual.entitlement),
              carried: fmtDays(b.annual.carriedIn),
              adjustments: fmtDays(b.annual.adjustments),
              taken: fmtDays(b.annual.taken),
              pending: fmtDays(b.annual.pending),
            })}
          </p>
          {b.accrual === 'monthly' && (
            <p className="mt-1 text-caption text-text-muted">{t('accruesMonthly')}</p>
          )}
        </div>
        {others.map((x) => (
          <div key={x.type.id} className={card}>
            <p className="text-caption text-text-muted">{name(x.type)}</p>
            {x.available !== null ? (
              <p className="ltr-iso text-h2 font-bold">{leftText(x.available)}</p>
            ) : (
              <p className="text-body-sm">{t('noBalance')}</p>
            )}
            <p className="text-caption text-text-muted">
              {t('takenLine', {
                taken: fmtDays(x.taken + x.unpaidTaken),
                pending: fmtDays(x.pending),
              })}
            </p>
          </div>
        ))}
      </div>
      <Section title={t('askLeave')}>
        <LeaveRequestForm types={data.types} />
      </Section>
      <h2 className="mt-6 text-h3">{t('myRequests')}</h2>
      <LeaveRequestsTable
        rows={data.requests}
        showPerson={false}
        actions={(r) =>
          r.status === 'pending_manager' || r.status === 'pending_hr' ? (
            <Decision
              compact
              cancelPath={`/me/leave/requests/${r.id}/cancel`}
              uploadPath={`/me/leave/requests/${r.id}/document`}
              uploadLabel={r.hasDocument ? t('replaceNote') : t('attachNote')}
            />
          ) : r.rejectReason ? (
            <span className="text-caption text-text-muted">{r.rejectReason}</span>
          ) : null
        }
      />
    </>
  );
}
