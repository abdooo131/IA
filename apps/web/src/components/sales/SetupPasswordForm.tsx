'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState } from 'react';
import { apiSend } from '@/lib/api-client';

const field = 'h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-body';

/** The new owner's password, typed twice; then they sign in as usual. */
export function SetupPasswordForm({
  token,
  who,
}: {
  token: string;
  who: { name: string; email: string; merchant: string | null };
}) {
  const t = useTranslations('setupPage');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done)
    return (
      <div role="status" className="space-y-4 rounded-lg border border-success bg-surface p-6">
        <p className="text-body">{t('done')}</p>
        <Link href="/login" className="btn-primary inline-flex items-center">
          {t('signIn')}
        </Link>
      </div>
    );
  return (
    <form
      className="space-y-4 rounded-lg border border-line bg-surface p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        if (password.length < 10) return setError(t('tooShort'));
        if (password !== again) return setError(t('mismatch'));
        setBusy(true);
        setError(null);
        const result = await apiSend('POST', `/auth/setup/${encodeURIComponent(token)}`, {
          password,
        });
        setBusy(false);
        if (!result.ok)
          return setError(result.error === 'setup_link_invalid' ? t('invalid') : t('error'));
        setDone(true);
      }}
    >
      <h1 className="text-h2">{t('title', { name: who.name })}</h1>
      <p className="text-body-sm text-text-muted">
        {t('intro', { merchant: who.merchant ?? '', email: who.email })}
      </p>
      <label className="block text-body-sm">
        <span className="font-semibold">{t('password')}</span>
        <input
          type="password"
          className={`${field} mt-1`}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <span className="text-caption text-text-muted">{t('rule')}</span>
      </label>
      <label className="block text-body-sm">
        <span className="font-semibold">{t('again')}</span>
        <input
          type="password"
          className={`${field} mt-1`}
          autoComplete="new-password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {error}
        </p>
      )}
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {t('save')}
      </button>
    </form>
  );
}
