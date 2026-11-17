'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { fmtDays } from '@/lib/leave';
import type { BalancesReport, LeaveType } from '@/lib/leave-types';
import { Feedback, field, primary, Section, td, th, useAction, useName } from './kit';

/**
 * Everyone's annual balance for a leave year (entitlement, carried in, HR's adjustments, taken,
 * waiting, left) and the other types they used; HR use adjusts a balance with a reason.
 */
export function BalancesView({
  report,
  types,
  canUse,
}: {
  report: BalancesReport;
  types: LeaveType[];
  canUse: boolean;
}) {
  const t = useTranslations('hr3');
  const name = useName();
  const action = useAction();
  const [employeeId, setEmployeeId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  const own = types.filter(
    (x) =>
      x.balance !== 'none' && (x.balance === 'own' || x.yearlyDays !== null || x.casualAllowance),
  );
  async function submit() {
    const ok = await action.send(
      'POST',
      '/hr/leave/adjustments',
      {
        employeeId,
        typeId: typeId || null,
        year: report.year,
        days: Number(days),
        reason,
      },
      t('saved'),
    );
    if (ok) {
      setDays('');
      setReason('');
    }
  }
  return (
    <>
      <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[760px] text-body-sm">
          <thead>
            <tr>
              <th className={th}>{t('person')}</th>
              <th className={`${th} text-end`}>{t('yearly')}</th>
              <th className={`${th} text-end`}>{t('entitlement')}</th>
              <th className={`${th} text-end`}>{t('carriedIn')}</th>
              <th className={`${th} text-end`}>{t('adjustments')}</th>
              <th className={`${th} text-end`}>{t('taken')}</th>
              <th className={`${th} text-end`}>{t('pending')}</th>
              <th className={`${th} text-end`}>{t('remaining')}</th>
              <th className={th}>{t('otherLeave')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {report.people.map((p) => (
              <tr key={p.employee.id}>
                <td className={td}>
                  <span className="block font-bold">{name(p.employee)}</span>
                  <span className="ltr-iso text-caption text-text-muted">
                    {p.employee.code}
                    {p.store ? ` · ${p.store.code}` : ''}
                  </span>
                </td>
                <td className={`${td} ltr-iso text-end`}>
                  {p.annualDays}
                  <span className="block text-caption text-text-muted">
                    {t(`sources.${p.annualSource}`)}
                  </span>
                </td>
                <td className={`${td} ltr-iso text-end`}>{fmtDays(p.annual.entitlement)}</td>
                <td className={`${td} ltr-iso text-end`}>{fmtDays(p.annual.carriedIn)}</td>
                <td className={`${td} ltr-iso text-end`}>{fmtDays(p.annual.adjustments)}</td>
                <td className={`${td} ltr-iso text-end`}>{fmtDays(p.annual.taken)}</td>
                <td className={`${td} ltr-iso text-end`}>{fmtDays(p.annual.pending)}</td>
                <td
                  className={`${td} ltr-iso text-end font-bold ${p.annual.remaining < 0 ? 'text-danger' : ''}`}
                >
                  {fmtDays(p.annual.remaining)}
                </td>
                <td className={td}>
                  {p.types.length === 0
                    ? '–'
                    : p.types.map((x) => (
                        <span key={x.typeId} className="block text-caption">
                          {name(x)}: {fmtDays(x.taken + x.unpaid)}
                          {x.pending > 0 && ` (+${fmtDays(x.pending)})`}
                        </span>
                      ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canUse && (
        <Section title={t('adjustTitle', { year: report.year })}>
          <p className="mt-1 text-caption text-text-muted">{t('adjustHint')}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block text-caption">
              {t('person')}
              <select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className={field}
              >
                <option value="">{t('choosePerson')}</option>
                {report.people.map((p) => (
                  <option key={p.employee.id} value={p.employee.id}>
                    {name(p.employee)} ({p.employee.code})
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-caption">
              {t('balance')}
              <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className={field}>
                <option value="">{t('annualBalance')}</option>
                {own.map((x) => (
                  <option key={x.id} value={x.id}>
                    {name(x)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-caption">
              {t('daysPlusMinus')}
              <input
                value={days}
                onChange={(e) => setDays(e.target.value)}
                inputMode="decimal"
                dir="ltr"
                className={field}
              />
            </label>
            <label className="block text-caption">
              {t('reason')}
              <input value={reason} onChange={(e) => setReason(e.target.value)} className={field} />
            </label>
          </div>
          <button
            type="button"
            className={`${primary} mt-3`}
            disabled={
              action.busy ||
              !employeeId ||
              !Number(days) ||
              !Number.isInteger(Number(days) * 2) ||
              reason.trim().length < 3
            }
            onClick={() => void submit()}
          >
            {t('saveAdjustment')}
          </button>
          <Feedback error={action.error} done={action.done} />
        </Section>
      )}
    </>
  );
}
