'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { penaltyWords } from '@/lib/leave';
import type { Violation } from '@/lib/leave-types';
import { day, StatePill, td, th, useName } from './kit';

/** The penalty of a violation in words (a written warning, 0.25 day of pay...). */
export function PenaltyText({
  p,
}: {
  p: { penalty: Violation['penalty']; days: number | null; amountPiastres: number | null };
}) {
  const t = useTranslations('hr3');
  const w = penaltyWords(p);
  return <>{t(`penalties.${w.key}`, w.values)}</>;
}

/** Violations as a table on wide screens and cards on phones. */
export function ViolationsTable({
  rows,
  hrefBase,
  showPerson = true,
  actions,
}: {
  rows: Violation[];
  hrefBase?: string;
  showPerson?: boolean;
  actions?: (v: Violation) => ReactNode;
}) {
  const t = useTranslations('hr3');
  const name = useName();
  if (rows.length === 0)
    return <p className="mt-4 text-body text-text-muted">{t('noViolations')}</p>;
  const number = (v: Violation) =>
    hrefBase ? (
      <Link href={`${hrefBase}/${v.id}`} className="ltr-iso font-bold text-link">
        {v.number}
      </Link>
    ) : (
      <span className="ltr-iso font-bold">{v.number}</span>
    );
  const extra = (v: Violation) => (
    <>
      {v.forSupplier && (
        <span className="mt-1 block text-caption text-status-needs-action">
          {t('tellCompany', { company: v.employee.staffingSupplier?.name ?? '–' })}
        </span>
      )}
      {v.inPayroll && <span className="mt-1 block text-caption">{t('inPayroll')}</span>}
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
              <th className={th}>{t('violation')}</th>
              <th className={th}>{t('date')}</th>
              <th className={th}>{t('penalty')}</th>
              <th className={th}>{t('status')}</th>
              {actions && <th className={th} />}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((v) => (
              <tr key={v.id}>
                <td className={td}>{number(v)}</td>
                {showPerson && (
                  <td className={td}>
                    <span className="block font-bold">{name(v.employee)}</span>
                    <span className="ltr-iso text-caption text-text-muted">
                      {v.employee.code}
                      {v.employee.store ? ` · ${v.employee.store.code}` : ''}
                    </span>
                  </td>
                )}
                <td className={td}>
                  {name(v.type)}
                  <span className="block text-caption text-text-muted">
                    {t('stepOf', { step: v.step })}
                  </span>
                </td>
                <td className={td}>{day(v.occurredOn)}</td>
                <td className={td}>
                  <PenaltyText p={v} />
                  {extra(v)}
                </td>
                <td className={td}>
                  <StatePill status={v.status} />
                </td>
                {actions && <td className={`${td} text-end`}>{actions(v)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-4 grid gap-2 md:hidden">
        {rows.map((v) => (
          <li key={v.id} className="rounded-lg border border-line bg-surface p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {number(v)}
              <StatePill status={v.status} />
            </div>
            {showPerson && <p className="mt-1 font-bold">{name(v.employee)}</p>}
            <p className="mt-1 text-body-sm">
              {name(v.type)} · {day(v.occurredOn)}
            </p>
            <p className="text-body-sm text-text-muted">
              {t('stepOf', { step: v.step })} · <PenaltyText p={v} />
            </p>
            {extra(v)}
            {actions && <div className="mt-2">{actions(v)}</div>}
          </li>
        ))}
      </ul>
    </>
  );
}
