'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { FormFooter } from '@/components/workflow/FormFooter';
import { apiSend } from '@/lib/api-client';
import { formatCairoDateTime } from '@/lib/format';
import type { Assignee, TicketList, TicketRow } from '@/lib/ticket-types';

const field =
  'mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-body-sm text-text';
const primary =
  'h-10 rounded-md bg-primary px-4 font-bold text-on-primary active:bg-primary-pressed disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]';
const KNOWN = ['assignee_not_found', 'cannot_assign_self', 'validation_failed'];

/** Late means the answer is still owed and its time has passed. */
export function isLate(t: Pick<TicketRow, 'status' | 'dueAt'>) {
  return t.status === 'open' && new Date(t.dueAt).getTime() < Date.now();
}

function NewTicket({
  assignees,
  presetTo,
  about,
  onClose,
}: {
  assignees: Assignee[];
  presetTo?: string;
  about?: string;
  onClose: () => void;
}) {
  const t = useTranslations('tickets');
  const tRoles = useTranslations('roles');
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "about" is type/id of the record the ticket is opened from, for example order/<id>.
  const [relatedType, relatedId] = about?.split('/') ?? [];

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const result = await apiSend<{ id: string }>('POST', '/tickets', {
      title: String(f.get('title') ?? '').trim(),
      body: String(f.get('body') ?? '').trim(),
      assigneeId: String(f.get('assigneeId') ?? ''),
      priority: f.get('urgent') ? 'urgent' : 'normal',
      relatedType: relatedType || undefined,
      relatedId: relatedId || undefined,
    });
    setBusy(false);
    if (!result.ok)
      return setError(t(`errors.${KNOWN.includes(result.error) ? result.error : 'generic'}`));
    setDirty(false);
    router.push(`/tickets/${result.data.id}`);
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      onChange={() => setDirty(true)}
      className="mt-4 space-y-3 rounded-lg border border-line bg-surface p-4"
    >
      <h2 className="text-h3">{t('new')}</h2>
      <label className="block text-caption">
        {t('to')}
        <select name="assigneeId" required defaultValue={presetTo ?? ''} className={field}>
          <option value="" disabled>
            …
          </option>
          {assignees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {tRoles(a.role)}
              {a.slackUserId ? ' · Slack' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-caption">
        {t('subject')}
        <input name="title" required minLength={3} maxLength={140} className={field} />
      </label>
      <label className="block text-caption">
        {t('message')}
        <textarea name="body" required rows={5} maxLength={4000} className={field} />
      </label>
      <label className="flex items-center gap-2 text-body-sm">
        <input type="checkbox" name="urgent" /> {t('urgent')}
      </label>
      {about && (
        <p className="ltr-iso text-caption text-text-muted">{t('about', { record: about })}</p>
      )}
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
      <FormFooter dirty={dirty} busy={busy} saveLabel={t('send')} onCancel={onClose} />
    </form>
  );
}

export function TicketsInbox({
  list,
  box,
  admin,
  assignees,
  startOpen,
  presetTo,
  about,
}: {
  list: TicketList;
  box: 'inbox' | 'sent' | 'all';
  admin: boolean;
  assignees: Assignee[];
  startOpen: boolean;
  presetTo?: string;
  about?: string;
}) {
  const t = useTranslations('tickets');
  const tw = useTranslations('workflow.states');
  const locale = useLocale();
  const [adding, setAdding] = useState(startOpen);
  const tab = (k: string) =>
    `rounded-md px-4 py-2 text-body-sm font-bold ${k === box ? 'bg-selected-bg text-link' : 'text-text-muted'}`;
  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!adding && (
          <button type="button" className={primary} onClick={() => setAdding(true)}>
            {t('new')}
          </button>
        )}
        <nav className="flex gap-1">
          <Link href="/tickets?box=inbox" className={tab('inbox')}>
            {t('inbox')}
            {list.unread > 0 && (
              <span className="ms-1 rounded-pill bg-status-needs-action px-2 text-caption text-on-primary">
                {list.unread}
              </span>
            )}
          </Link>
          <Link href="/tickets?box=sent" className={tab('sent')}>
            {t('sent')}
          </Link>
          {admin && (
            <Link href="/tickets?box=all" className={tab('all')}>
              {t('all')}
            </Link>
          )}
        </nav>
      </div>
      {adding && (
        <NewTicket
          assignees={assignees}
          presetTo={presetTo}
          about={about}
          onClose={() => setAdding(false)}
        />
      )}
      {list.rows.length === 0 ? (
        <p className="mt-6 text-body text-text-muted">{t('none')}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-surface">
          {list.rows.map((r) => {
            const late = isLate(r);
            const unread = box === 'inbox' && r.status === 'open' && !r.readAt;
            return (
              <li key={r.id}>
                <Link href={`/tickets/${r.id}`} className="flex flex-wrap items-center gap-3 p-3">
                  <span className="ltr-iso w-24 shrink-0 text-caption font-bold text-link">
                    {r.number}
                  </span>
                  <span className={`min-w-0 flex-1 ${unread ? 'font-bold' : ''}`}>
                    {r.title}
                    <span className="block text-caption text-text-muted">
                      {box === 'sent'
                        ? t('toName', { name: r.assignee })
                        : t('fromName', { name: r.createdBy })}
                      {' · '}
                      <span className="ltr-iso">{formatCairoDateTime(r.createdAt, locale)}</span>
                    </span>
                  </span>
                  {r.priority === 'urgent' && (
                    <span className="rounded-pill border border-danger px-2 text-caption text-danger">
                      {t('urgentShort')}
                    </span>
                  )}
                  <span
                    className={`rounded-pill px-2 text-caption font-bold ${
                      late
                        ? 'bg-danger text-on-primary'
                        : r.status === 'open'
                          ? 'bg-status-needs-action text-on-primary'
                          : 'border border-line'
                    }`}
                  >
                    {late ? t('late') : tw(r.status)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
