'use client';
import { Wordmark } from '@/shell/Wordmark';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { safeNextPath } from '@shiply/shared';

export default function LoginPage() {
  const t = useTranslations('login');
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: f.get('login'), password: f.get('password') }),
    });
    setBusy(false);
    if (res.ok) {
      // Only a page of this site, never another address.
      const next = safeNextPath(new URLSearchParams(window.location.search).get('next'));
      window.location.assign(next ?? `/${locale}`);
      return;
    }
    const body = await res.json().catch(() => ({}));
    setError(['wrong_login', 'locked', 'invalid'].includes(body.error) ? body.error : 'wrong_login');
  }

  return (
    <main className="login">
      <form onSubmit={submit} className="card login-card">
        <Wordmark size={34} />
        <h1>{t('title')}</h1>
        <label>
          {t('login')}
          <input name="login" autoComplete="username" required dir="auto" />
        </label>
        <label>
          {t('password')}
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {t(error)}
          </p>
        )}
        <button className="btn primary" disabled={busy}>
          {t('submit')}
        </button>
      </form>
    </main>
  );
}
