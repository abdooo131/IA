'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';

const field = 'h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-body';

/** Accept (signer's name and title) or decline (name and an optional reason) a proposal. */
export function ProposalAnswer({ token }: { token: string }) {
  const t = useTranslations('proposalPage');
  const router = useRouter();
  const [mode, setMode] = useState<'accept' | 'decline'>('accept');
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    const result =
      mode === 'accept'
        ? await apiSend('POST', `/proposal/${encodeURIComponent(token)}/accept`, {
            signerName: name,
            signerTitle: title,
          })
        : await apiSend('POST', `/proposal/${encodeURIComponent(token)}/decline`, {
            signerName: name,
            reason: reason || null,
          });
    setBusy(false);
    if (!result.ok)
      return setError(
        t.has(`errors.${result.error}`) ? t(`errors.${result.error}`) : t('errors.generic'),
      );
    router.refresh();
  }

  const ready =
    name.trim().length >= 2 && (mode === 'decline' || (title.trim().length >= 2 && agree));
  return (
    <form
      className="space-y-4 rounded-lg border border-line bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <h2 className="text-h3">{mode === 'accept' ? t('acceptTitle') : t('declineTitle')}</h2>
      <label className="block text-body-sm">
        <span className="font-semibold">{t('signerName')}</span>
        <input
          className={`${field} mt-1`}
          value={name}
          autoComplete="name"
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {mode === 'accept' ? (
        <>
          <label className="block text-body-sm">
            <span className="font-semibold">{t('signerTitle')}</span>
            <input
              className={`${field} mt-1`}
              value={title}
              autoComplete="organization-title"
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="flex items-start gap-2 text-body-sm">
            <input
              type="checkbox"
              className="mt-1 h-5 w-5"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
            />
            <span>{t('agree')}</span>
          </label>
        </>
      ) : (
        <label className="block text-body-sm">
          <span className="font-semibold">{t('declineReason')}</span>
          <textarea
            className="mt-1 min-h-20 w-full rounded-md border border-line-strong bg-surface p-3 text-body"
            value={reason}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      )}
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={busy || !ready}>
          {mode === 'accept' ? t('acceptButton') : t('declineButton')}
        </button>
        <button
          type="button"
          className="text-body-sm text-link underline"
          onClick={() => {
            setMode(mode === 'accept' ? 'decline' : 'accept');
            setError(null);
          }}
        >
          {mode === 'accept' ? t('switchToDecline') : t('switchToAccept')}
        </button>
      </div>
    </form>
  );
}
