'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { newActionKey } from '@/lib/ids';
import { cairoClock } from '@/lib/leave';
import type { Correction } from '@/lib/leave-types';
import { Decision } from './Decision';
import {
  area,
  dateField,
  day,
  Feedback,
  field,
  primary,
  Section,
  StatePill,
  useAction,
} from './kit';

/**
 * My attendance fixes: ask to fix a day (what is wrong and the times it should show); the
 * manager approves, then HR applies it. Waiting ones can be withdrawn.
 */
export function MyCorrectionsView({ rows, today }: { rows: Correction[]; today: string }) {
  const t = useTranslations('hr3');
  const action = useAction();
  const [dayValue, setDay] = useState('');
  const [problem, setProblem] = useState('');
  const [inTime, setIn] = useState('');
  const [outTime, setOut] = useState('');
  const [key, setKey] = useState(newActionKey);
  async function submit() {
    const ok = await action.send(
      'POST',
      '/me/corrections',
      {
        day: dayValue,
        problem,
        proposedIn: inTime || null,
        proposedOut: outTime || null,
        idempotencyKey: key,
      },
      t('requestSent'),
    );
    if (ok) {
      setKey(newActionKey());
      setProblem('');
      setIn('');
      setOut('');
    }
  }
  return (
    <>
      <Section title={t('askCorrection')}>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="block text-caption">
            <span className="block">{t('day')}</span>
            <DateInput
              className={dateField}
              value={dayValue}
              max={today}
              onChange={(e) => setDay(e.target.value)}
            />
          </label>
          <label className="block text-caption">
            {t('proposedIn')}
            <input
              type="time"
              value={inTime}
              onChange={(e) => setIn(e.target.value)}
              dir="ltr"
              className={field}
            />
          </label>
          <label className="block text-caption">
            {t('proposedOut')}
            <input
              type="time"
              value={outTime}
              onChange={(e) => setOut(e.target.value)}
              dir="ltr"
              className={field}
            />
          </label>
          <label className="block text-caption sm:col-span-3">
            {t('whatIsWrong')}
            <textarea
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
              className={area}
            />
          </label>
        </div>
        <button
          type="button"
          className={`${primary} mt-3`}
          disabled={action.busy || !dayValue || problem.trim().length < 3 || (!inTime && !outTime)}
          onClick={() => void submit()}
        >
          {t('sendRequest')}
        </button>
        <Feedback error={action.error} done={action.done} />
      </Section>
      <h2 className="mt-6 text-h3">{t('myCorrections')}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-body text-text-muted">{t('noCorrections')}</p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {rows.map((c) => (
            <li key={c.id} className="rounded-lg border border-line bg-surface p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="ltr-iso font-bold">{c.number}</span>
                <StatePill status={c.status} />
              </div>
              <p className="mt-1 text-body-sm">
                {day(c.day)} · {c.problem}
              </p>
              <p className="ltr-iso text-caption text-text-muted">
                {cairoClock(c.proposedIn) || '–'} → {cairoClock(c.proposedOut) || '–'}
              </p>
              {c.rejectReason && <p className="text-caption text-danger">{c.rejectReason}</p>}
              {(c.status === 'pending_manager' || c.status === 'pending_hr') && (
                <Decision compact cancelPath={`/me/corrections/${c.id}/cancel`} />
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
