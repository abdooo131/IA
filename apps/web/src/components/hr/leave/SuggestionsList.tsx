'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { newActionKey } from '@/lib/ids';
import type { Suggestion } from '@/lib/leave-types';
import { day, Feedback, primary, secondary, useAction, useName } from './kit';

/**
 * Violations the attendance close suggests (late past the grace, absent without leave): HR use
 * confirms one onto the person's ladder or dismisses it with one tap.
 */
export function SuggestionsList({ rows, canUse }: { rows: Suggestion[]; canUse: boolean }) {
  const t = useTranslations('hr3');
  const name = useName();
  const action = useAction();
  const [keys] = useState(() => new Map<string, string>());
  const keyOf = (id: string) => {
    if (!keys.has(id)) keys.set(id, newActionKey());
    return keys.get(id)!;
  };
  if (rows.length === 0)
    return <p className="mt-4 text-body text-text-muted">{t('noSuggestions')}</p>;
  return (
    <>
      <Feedback error={action.error} done={action.done} />
      <ul className="mt-4 grid gap-2 lg:grid-cols-2">
        {rows.map((s) => (
          <li key={s.id} className="rounded-lg border border-line bg-surface p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-bold">{name(s.employee)}</p>
                <p className="ltr-iso text-caption text-text-muted">
                  {s.employee.code}
                  {s.employee.store ? ` · ${s.employee.store.code}` : ''}
                </p>
              </div>
              <span
                className={`rounded-pill px-2 py-0.5 text-caption font-bold ${
                  s.kind === 'absent'
                    ? 'bg-[color-mix(in_srgb,currentColor_14%,transparent)] text-danger'
                    : 'bg-[color-mix(in_srgb,currentColor_14%,transparent)] text-status-needs-action'
                }`}
              >
                {s.kind === 'late' ? t('lateBy', { minutes: s.lateMinutes }) : t('absentDay')}
              </span>
            </div>
            <p className="mt-2 text-body-sm">
              {day(s.day)} · {s.type ? name(s.type) : t('noTypeYet')}
            </p>
            {s.violation && (
              <Link href={`/admin/hr/violations/${s.violation.id}`} className="text-link">
                {s.violation.number}
              </Link>
            )}
            {canUse && s.status === 'open' && (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`${primary} h-9 px-3`}
                  disabled={action.busy || !s.type}
                  onClick={() =>
                    void action.send(
                      'POST',
                      `/hr/violations/suggestions/${s.id}/confirm`,
                      { idempotencyKey: keyOf(s.id) },
                      t('recorded'),
                    )
                  }
                >
                  {t('confirm')}
                </button>
                <button
                  type="button"
                  className={`${secondary} h-9 px-3`}
                  disabled={action.busy}
                  onClick={() =>
                    void action.send(
                      'POST',
                      `/hr/violations/suggestions/${s.id}/dismiss`,
                      {},
                      t('dismissed'),
                    )
                  }
                >
                  {t('dismiss')}
                </button>
                <Link
                  href={`/admin/hr/attendance/day?employeeId=${s.employee.id}&day=${s.day}`}
                  className="flex h-9 items-center text-body-sm text-link"
                >
                  {t('openDay')}
                </Link>
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
