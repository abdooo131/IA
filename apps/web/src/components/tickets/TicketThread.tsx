'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { FormFooter } from '@/components/workflow/FormFooter';
import { StatusBar } from '@/components/workflow/StatusBar';
import { apiSend } from '@/lib/api-client';
import { formatCairoDateTime } from '@/lib/format';
import type { TicketDetail } from '@/lib/ticket-types';
import { isLate } from './TicketsInbox';

const button =
  'h-10 rounded-md border border-line bg-surface px-4 text-body-sm font-bold disabled:opacity-50';

/** One ticket: its status, who owes what by when, the conversation and the reply box. */
export function TicketThread({ ticket }: { ticket: TicketDetail }) {
  const t = useTranslations('tickets');
  const locale = useLocale();
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  // New answers can arrive from Slack at any moment: look again every 20 seconds.
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 20_000);
    return () => clearInterval(timer);
  }, [router]);

  async function send(path: string, payload: unknown) {
    setBusy(true);
    setError(false);
    const result = await apiSend('POST', path, payload);
    setBusy(false);
    if (!result.ok) {
      setError(true);
      return false;
    }
    router.refresh();
    return true;
  }

  const late = isLate(ticket);
  return (
    <article className="mt-2">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-h2">
          <span className="ltr-iso me-2 text-text-muted">{ticket.number}</span>
          {ticket.title}
        </h1>
        {ticket.priority === 'urgent' && (
          <span className="rounded-pill border border-danger px-2 text-caption text-danger">
            {t('urgentShort')}
          </span>
        )}
      </div>
      <StatusBar flow="ticket" status={ticket.status} />
      <dl className="mt-3 grid gap-2 rounded-lg border border-line bg-surface p-4 text-body-sm sm:grid-cols-2">
        <div>
          <dt className="text-text-muted">{t('from')}</dt>
          <dd>{ticket.createdBy.name}</dd>
        </div>
        <div>
          <dt className="text-text-muted">{t('to')}</dt>
          <dd>
            {ticket.assignee.name}
            {ticket.assignee.inSlack && <span className="text-text-muted"> · Slack</span>}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">{t('answerBy')}</dt>
          <dd className={late ? 'font-bold text-danger' : ''}>
            <span className="ltr-iso">{formatCairoDateTime(ticket.dueAt, locale)}</span>
            {late && ` · ${t('late')}`}
          </dd>
        </div>
        <div>
          <dt className="text-text-muted">{t('seen')}</dt>
          <dd>
            {ticket.readAt ? (
              <span className="ltr-iso">{formatCairoDateTime(ticket.readAt, locale)}</span>
            ) : (
              t('notSeen')
            )}
          </dd>
        </div>
        {ticket.relatedType && (
          <div className="sm:col-span-2">
            <dt className="text-text-muted">{t('aboutLabel')}</dt>
            <dd className="ltr-iso">
              {ticket.relatedType} · {ticket.relatedId}
            </dd>
          </div>
        )}
      </dl>

      <ol className="mt-4 space-y-3">
        {ticket.messages.map((m) => (
          <li
            key={m.id}
            className={`max-w-[85%] rounded-lg border p-3 ${
              m.mine ? 'ms-auto border-primary bg-selected-bg' : 'border-line bg-surface'
            }`}
          >
            <p className="text-caption text-text-muted">
              <span className="font-bold text-text">{m.authorName}</span>
              {' · '}
              <span className="ltr-iso">{formatCairoDateTime(m.at, locale)}</span>
              {m.source === 'slack' && ` · ${t('viaSlack')}`}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-body-sm" dir="auto">
              {m.body}
            </p>
          </li>
        ))}
      </ol>

      {ticket.status !== 'closed' ? (
        <form
          className="mt-4 space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await send(`/tickets/${ticket.id}/messages`, { body })) setBody('');
          }}
        >
          <label className="block text-caption">
            {t('reply')}
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              maxLength={4000}
              required
              dir="auto"
              className="mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-body-sm"
            />
          </label>
          <FormFooter
            dirty={body.trim().length > 0}
            busy={busy}
            saveLabel={t('send')}
            disabled={body.trim().length === 0}
            onCancel={() => setBody('')}
          />
        </form>
      ) : null}
      {error && (
        <p role="alert" className="mt-2 text-body-sm text-danger">
          {t('errors.generic')}
        </p>
      )}
      <div className="mt-4">
        {ticket.status === 'closed' ? (
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => void send(`/tickets/${ticket.id}/reopen`, {})}
          >
            {t('reopen')}
          </button>
        ) : (
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => {
              if (window.confirm(t('closeConfirm'))) void send(`/tickets/${ticket.id}/close`, {});
            }}
          >
            {t('close')}
          </button>
        )}
      </div>
    </article>
  );
}
