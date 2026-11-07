'use client';

import { CRM_ACTIVITY_TYPES, type CrmActivityType } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { apiSend } from '@/lib/api-client';
import { formatCairoDateTime } from '@/lib/format';
import { newActionKey } from '@/lib/ids';
import { type Activity, cairoInstant, tomorrowInCairo } from '@/lib/sales';

const field = 'h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-body-sm';

/**
 * Log what happened (a call, a meeting, a message, a note) or schedule the next step with its
 * date and time in Cairo. Every save sends its own idempotency key, so a double tap saves once.
 */
export function ActivityComposer({
  dealId,
  companyId,
  defaultMode = 'log',
}: {
  dealId?: string;
  companyId?: string;
  defaultMode?: 'log' | 'plan';
}) {
  const t = useTranslations('sales');
  const router = useRouter();
  const [mode, setMode] = useState<'log' | 'plan'>(defaultMode);
  const [type, setType] = useState<CrmActivityType>('call');
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('');
  const [day, setDay] = useState(() => tomorrowInCairo());
  const [time, setTime] = useState('10:00');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [key, setKey] = useState(() => newActionKey());

  async function submit() {
    const dueAt = mode === 'plan' ? cairoInstant(day, time) : null;
    if (subject.trim().length < 2)
      return setMessage({ text: t('errors.subject_required'), error: true });
    if (mode === 'plan' && !dueAt)
      return setMessage({ text: t('errors.due_required'), error: true });
    setBusy(true);
    const result = await apiSend('POST', '/sales/activities', {
      ...(dealId ? { dealId } : { companyId }),
      type,
      subject: subject.trim(),
      notes: notes.trim() || null,
      done: mode === 'log',
      ...(dueAt && { dueAt }),
      idempotencyKey: key,
    });
    setBusy(false);
    if (!result.ok)
      return setMessage({
        text: t.has(`errors.${result.error}`) ? t(`errors.${result.error}`) : t('errors.generic'),
        error: true,
      });
    setSubject('');
    setNotes('');
    setKey(newActionKey());
    setMessage({
      text: mode === 'log' ? t('activity.logged') : t('activity.planned'),
      error: false,
    });
    router.refresh();
  }

  const tab = (on: boolean) =>
    `rounded-md px-3 py-1.5 text-body-sm font-bold ${on ? 'bg-selected-bg text-link' : 'text-text-muted'}`;
  return (
    <form
      className="space-y-3 rounded-lg border border-line bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap gap-1" role="group" aria-label={t('activity.mode')}>
        <button
          type="button"
          className={tab(mode === 'log')}
          aria-pressed={mode === 'log'}
          onClick={() => setMode('log')}
        >
          {t('activity.log')}
        </button>
        <button
          type="button"
          className={tab(mode === 'plan')}
          aria-pressed={mode === 'plan'}
          onClick={() => setMode('plan')}
        >
          {t('activity.schedule')}
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <label className="text-body-sm">
          <span className="font-semibold">{t('activity.type')}</span>
          <select
            className={`${field} mt-1`}
            value={type}
            onChange={(e) => setType(e.target.value as CrmActivityType)}
          >
            {CRM_ACTIVITY_TYPES.map((x) => (
              <option key={x} value={x}>
                {t(`activityTypes.${x}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-body-sm">
          <span className="font-semibold">{t('activity.subject')}</span>
          <input
            className={`${field} mt-1`}
            value={subject}
            maxLength={160}
            placeholder={
              mode === 'log' ? t('activity.subjectLogHint') : t('activity.subjectPlanHint')
            }
            onChange={(e) => setSubject(e.target.value)}
          />
        </label>
      </div>
      {mode === 'plan' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-body-sm">
            <span className="font-semibold">{t('activity.day')}</span>
            <DateInput value={day} onChange={(e) => setDay(e.target.value)} className="mt-1" />
          </label>
          <label className="text-body-sm">
            <span className="font-semibold">{t('activity.time')}</span>
            <input
              type="time"
              className={`${field} mt-1`}
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </label>
        </div>
      )}
      <label className="block text-body-sm">
        <span className="font-semibold">{t('activity.notes')}</span>
        <textarea
          className="mt-1 min-h-20 w-full rounded-md border border-line-strong bg-surface p-2 text-body-sm"
          value={notes}
          maxLength={4000}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={busy}>
          {mode === 'log' ? t('activity.saveLog') : t('activity.savePlan')}
        </button>
        {message && (
          <p
            role="status"
            className={`text-body-sm ${message.error ? 'text-danger' : 'text-text-muted'}`}
          >
            {message.text}
          </p>
        )}
      </div>
    </form>
  );
}

/** Marks an open follow up done, with what came of it. */
export function DoneButton({ activityId }: { activityId: string }) {
  const t = useTranslations('sales');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');
  async function done() {
    setState('busy');
    const result = await apiSend('POST', `/sales/activities/${activityId}/done`, {
      outcome: outcome.trim() || null,
    });
    if (!result.ok) return setState('error');
    setState('idle');
    setOpen(false);
    router.refresh();
  }
  if (!open)
    return (
      <button
        type="button"
        className="text-body-sm font-bold text-link"
        onClick={() => setOpen(true)}
      >
        {t('activity.markDone')}
      </button>
    );
  return (
    <form
      className="mt-2 flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void done();
      }}
    >
      <label className="min-w-0 flex-1 text-caption">
        <span className="text-text-muted">{t('activity.outcome')}</span>
        <input
          className={`${field} mt-1`}
          value={outcome}
          maxLength={1000}
          autoFocus
          onChange={(e) => setOutcome(e.target.value)}
        />
      </label>
      <button type="submit" className="btn-primary" disabled={state === 'busy'}>
        {t('activity.done')}
      </button>
      <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
        {t('cancel')}
      </button>
      {state === 'error' && (
        <p role="alert" className="w-full text-caption text-danger">
          {t('errors.generic')}
        </p>
      )}
    </form>
  );
}

/** The activity timeline, newest first: planned steps show their date, done ones their outcome. */
export function ActivityTimeline({
  activities,
  canEdit,
  showCompany,
}: {
  activities: (Activity & { company?: { id: string; brandName: string } })[];
  canEdit: boolean;
  showCompany?: boolean;
}) {
  const t = useTranslations('sales');
  const locale = useLocale();
  const [now] = useState(() => Date.now());
  if (activities.length === 0)
    return <p className="mt-2 text-body-sm text-text-muted">{t('activity.none')}</p>;
  return (
    <ol className="mt-3 space-y-3 border-s-2 border-line ps-4">
      {activities.map((a) => {
        const overdue = !a.doneAt && a.dueAt && new Date(a.dueAt).getTime() < now;
        return (
          <li key={a.id} className="relative">
            <span
              aria-hidden
              className={`absolute -start-[23px] top-1.5 h-3 w-3 rounded-full ${
                a.doneAt
                  ? 'bg-primary'
                  : overdue
                    ? 'bg-danger'
                    : 'border-2 border-primary bg-surface'
              }`}
            />
            <p className="text-body-sm">
              <span className="font-bold">{t(`activityTypes.${a.type}`)}</span> · {a.subject}
            </p>
            <p className="text-caption text-text-muted">
              {a.doneAt ? (
                <>
                  {t('activity.doneAt')}{' '}
                  <span className="ltr-iso">{formatCairoDateTime(a.doneAt, locale)}</span>
                </>
              ) : (
                <span className={overdue ? 'font-bold text-danger' : ''}>
                  {overdue ? t('activity.overdueAt') : t('activity.dueAt')}{' '}
                  <span className="ltr-iso">{formatCairoDateTime(a.dueAt!, locale)}</span>
                </span>
              )}
              {' · '}
              {a.owner.name}
              {showCompany && a.company && (
                <>
                  {' · '}
                  <Link href={`/admin/sales/companies/${a.company.id}`} className="text-link">
                    {a.company.brandName}
                  </Link>
                </>
              )}
              {a.deal && (
                <>
                  {' · '}
                  <Link href={`/admin/sales/deals/${a.deal.id}`} className="ltr-iso text-link">
                    {a.deal.label}
                  </Link>
                </>
              )}
            </p>
            {a.notes && <p className="mt-1 whitespace-pre-line text-body-sm">{a.notes}</p>}
            {a.outcome && (
              <p className="mt-1 text-body-sm">
                <span className="font-semibold">{t('activity.outcome')}:</span> {a.outcome}
              </p>
            )}
            {!a.doneAt && canEdit && <DoneButton activityId={a.id} />}
          </li>
        );
      })}
    </ol>
  );
}
