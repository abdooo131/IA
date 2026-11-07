'use client';

import { cairoDay } from '@shiplynow/shared';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { DateInput } from '@/components/DateInput';
import { apiGetClient, apiSend } from '@/lib/api-client';
import { isoToDayFirst } from '@/lib/day-first';
import { formatCairoDateTime } from '@/lib/format';

interface Note {
  id: string;
  at: string;
  author: { id: string; name: string };
  body: string;
}
interface Activity {
  id: string;
  dueOn: string;
  note: string;
  doneAt: string | null;
  assignee: { id: string; name: string };
  createdBy: { id: string; name: string };
}

const field =
  'mt-1 block w-full rounded-md border border-line-strong bg-surface px-3 text-body-sm text-text';

/**
 * The live part of a document's chatter: notes (append only) and scheduled activities
 * ("Remind me" on a day, for a person). The record's history and attachments are rendered
 * by the server next to it.
 */
export function Chatter({
  entityType,
  entityId,
  canWrite,
  meId,
}: {
  entityType: string;
  entityId: string;
  canWrite: boolean;
  meId: string;
}) {
  const t = useTranslations('documents.chatter');
  const locale = useLocale();
  const base = `/records/${entityType}/${entityId}`;
  const [notes, setNotes] = useState<Note[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [tab, setTab] = useState<'note' | 'activity'>('note');
  const [body, setBody] = useState('');
  const today = cairoDay(new Date());
  const [due, setDue] = useState(today);
  const [what, setWhat] = useState('');
  const [who, setWho] = useState(meId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [n, a] = await Promise.all([
      apiGetClient<Note[]>(`${base}/notes`),
      apiGetClient<Activity[]>(`${base}/activities`),
    ]);
    if (n.ok) setNotes(n.data);
    if (a.ok) setActivities(a.data);
  }, [base]);
  useEffect(() => {
    void load();
    if (canWrite)
      void apiGetClient<{ id: string; name: string }[]>(`${base}/people`).then(
        (r) => r.ok && setPeople(r.data),
      );
  }, [load, base, canWrite]);

  const send = async (path: string, payload: unknown, done: () => void) => {
    setBusy(true);
    setError(null);
    const r = await apiSend('POST', path, payload);
    setBusy(false);
    if (!r.ok) {
      setError(t.has(`errors.${r.error}`) ? t(`errors.${r.error}`) : t('errors.generic'));
      return;
    }
    done();
    void load();
  };

  const open = activities.filter((a) => !a.doneAt);
  return (
    <div className="space-y-4">
      {canWrite && (
        <div className="rounded-lg border border-line bg-surface p-3">
          <div role="tablist" className="flex gap-1">
            {(['note', 'activity'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`h-9 rounded-md px-3 text-body-sm font-bold ${tab === k ? 'bg-selected-bg text-link' : 'text-text-muted hover:bg-surface-raised'}`}
              >
                {t(k === 'note' ? 'logNote' : 'remindMe')}
              </button>
            ))}
          </div>
          {tab === 'note' ? (
            <div className="mt-2">
              <label className="sr-only" htmlFor={`note-${entityId}`}>
                {t('logNote')}
              </label>
              <textarea
                id={`note-${entityId}`}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                maxLength={4000}
                placeholder={t('notePlaceholder')}
                className={`${field} py-2`}
              />
              <button
                type="button"
                disabled={busy || !body.trim()}
                onClick={() => void send(`${base}/notes`, { body }, () => setBody(''))}
                className="mt-2 h-10 rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary disabled:bg-line disabled:text-text-muted"
              >
                {t('postNote')}
              </button>
            </div>
          ) : (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="text-caption text-text-muted">
                {t('dueOn')}
                <DateInput
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                  dir="ltr"
                  className={`${field} h-10`}
                />
              </label>
              <label className="text-caption text-text-muted">
                {t('assignee')}
                <select
                  value={who}
                  onChange={(e) => setWho(e.target.value)}
                  className={`${field} h-10`}
                >
                  <option value={meId}>{t('me')}</option>
                  {people
                    .filter((p) => p.id !== meId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-caption text-text-muted sm:col-span-2">
                {t('what')}
                <input
                  value={what}
                  onChange={(e) => setWhat(e.target.value)}
                  maxLength={500}
                  placeholder={t('whatPlaceholder')}
                  className={`${field} h-10`}
                />
              </label>
              <button
                type="button"
                disabled={busy || !what.trim() || !due}
                onClick={() =>
                  void send(
                    `${base}/activities`,
                    { dueOn: due, note: what, ...(who !== meId ? { assigneeId: who } : {}) },
                    () => setWhat(''),
                  )
                }
                className="h-10 rounded-md bg-primary px-4 text-body-sm font-bold text-on-primary disabled:bg-line disabled:text-text-muted sm:w-fit"
              >
                {t('schedule')}
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-2 text-body-sm text-danger">
              {error}
            </p>
          )}
        </div>
      )}

      <section aria-labelledby={`activities-${entityId}`}>
        <h3 id={`activities-${entityId}`} className="text-label uppercase text-text-muted">
          {t('activities')}
        </h3>
        {open.length === 0 ? (
          <p className="mt-1 text-body-sm text-text-muted">{t('noActivities')}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {open.map((a) => {
              const late = a.dueOn < today;
              const isToday = a.dueOn === today;
              return (
                <li
                  key={a.id}
                  className="flex items-start gap-2 rounded-md border border-line bg-surface p-2 text-body-sm"
                >
                  <span
                    aria-hidden
                    className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${late ? 'bg-danger' : isToday ? 'bg-status-needs-action' : 'bg-status-delivered'}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{a.note}</p>
                    <p className="text-caption text-text-muted">
                      <span className="ltr-iso">{isoToDayFirst(a.dueOn)}</span>
                      {late ? ` · ${t('late')}` : isToday ? ` · ${t('today')}` : ''} ·{' '}
                      {a.assignee.name}
                    </p>
                  </div>
                  {(a.assignee.id === meId || a.createdBy.id === meId) && (
                    <button
                      type="button"
                      onClick={() =>
                        void send(`/records/activities/${a.id}/done`, {}, () => undefined)
                      }
                      className="h-9 shrink-0 rounded-md border border-line px-2 text-caption font-bold hover:bg-surface-raised"
                    >
                      {t('markDone')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby={`notes-${entityId}`}>
        <h3 id={`notes-${entityId}`} className="text-label uppercase text-text-muted">
          {t('notes')}
        </h3>
        {notes.length === 0 ? (
          <p className="mt-1 text-body-sm text-text-muted">{t('noNotes')}</p>
        ) : (
          <ol className="mt-2 space-y-3">
            {notes.map((n) => (
              <li key={n.id} className="flex gap-2">
                <span
                  aria-hidden
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-selected-bg text-caption font-bold text-link"
                >
                  {n.author.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="text-caption text-text-muted">
                    <span className="font-bold text-text">{n.author.name}</span> ·{' '}
                    <span className="ltr-iso">{formatCairoDateTime(n.at, locale)}</span>
                  </p>
                  <p className="whitespace-pre-wrap break-words text-body-sm">{n.body}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
