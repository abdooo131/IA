'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';
import { formatCairoDateTime } from '@/lib/format';
import { Card } from './Card';
import type { OrderScreenProps } from './types';

type Thread = 'team' | 'merchant';

/**
 * Notes on the order. The team thread is internal (admin, operations and the store's staff);
 * the merchant thread is shared with the merchant. Notes are never edited or deleted.
 */
export function NotesCard({ props }: { props: OrderScreenProps }) {
  const { notes, teamNotes, apiPath } = props;
  const t = useTranslations('orderDetail.notes');
  const locale = useLocale();
  const router = useRouter();
  const [thread, setThread] = useState<Thread>(teamNotes ? 'team' : 'merchant');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = (notes ?? [])
    .filter((n) => n.audience === thread)
    .slice()
    .reverse();

  async function add() {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    const result = await apiSend('POST', `${apiPath}/notes`, {
      ...(teamNotes ? { audience: thread } : {}),
      body: body.trim(),
    });
    setBusy(false);
    if (!result.ok) return setError(t('error'));
    setBody('');
    router.refresh();
  }

  const tab = (value: Thread) => (
    <button
      key={value}
      type="button"
      role="tab"
      aria-selected={thread === value}
      onClick={() => setThread(value)}
      className={`flex-1 rounded-md px-3 py-1.5 text-caption font-bold ${
        thread === value ? 'bg-surface text-text shadow-sm' : 'text-text-muted'
      }`}
    >
      {t(value === 'team' ? 'team' : 'merchant')}
      <span className="ltr-iso ms-1 text-text-muted">
        {(notes ?? []).filter((n) => n.audience === value).length}
      </span>
    </button>
  );

  return (
    <Card title={t('title')} icon="chat">
      {teamNotes && (
        <div role="tablist" className="mb-3 flex gap-1 rounded-lg bg-surface-raised p-1">
          {tab('team')}
          {tab('merchant')}
        </div>
      )}
      <p className="mb-3 text-caption text-text-muted">
        {t(thread === 'team' ? 'teamHint' : teamNotes ? 'merchantHintTeam' : 'merchantHint')}
      </p>
      <label className="block">
        <span className="sr-only">{t('placeholder')}</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={1000}
          rows={3}
          placeholder={t('placeholder')}
          className="block w-full rounded-md border border-line bg-surface px-3 py-2 text-body-sm"
        />
      </label>
      {error && (
        <p role="alert" className="mt-1 text-caption text-danger">
          {error}
        </p>
      )}
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          className="btn-primary"
          disabled={busy || !body.trim()}
          onClick={() => void add()}
        >
          {t('add')}
        </button>
      </div>
      {notes === null ? (
        <p className="mt-3 text-caption text-text-muted">{t('unavailable')}</p>
      ) : shown.length === 0 ? (
        <p className="mt-3 text-caption text-text-muted">{t('empty')}</p>
      ) : (
        <ol className="mt-3 space-y-3">
          {shown.map((n) => (
            <li key={n.id} className="rounded-lg bg-surface-raised px-3 py-2">
              <p className="whitespace-pre-wrap break-words text-body-sm">{n.body}</p>
              <p className="mt-1 text-caption text-text-muted">
                <span className="font-bold">{n.author}</span>
                {n.fromMerchant && <> · {t('fromMerchant')}</>}
                {' · '}
                <span className="ltr-iso">{formatCairoDateTime(n.at, locale)}</span>
              </p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
