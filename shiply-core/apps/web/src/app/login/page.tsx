'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Logo, LogoOnColor } from '@/components/Logo';
import { HOME_BY_ROLE, type Me } from '@/components/Shell';
import { Alert, Button, Field, Input } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { PreferencesMenu } from '@/components/PreferencesMenu';
import { useT } from '@/lib/i18n';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/login', { body: { login: email, password } });
      const me = await api<Me>('/auth/me');
      const next = params.get('next');
      router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : HOME_BY_ROLE[me.role]);
    } catch (err) {
      setError(t(errorMessage(err)));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert>{error}</Alert>}
      <Field label={t('Email or phone')}>
        <Input type="text" inputMode="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="ltr-iso" />
      </Field>
      <Field label={t('Password')}>
        <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button type="submit" disabled={busy} className="w-full min-h-12 text-body">{busy ? t('Signing in…') : t('Sign in')}</Button>
    </form>
  );
}

export default function LoginPage() {
  const t = useT();
  return (
    <div className="flex min-h-dvh bg-bg">
      <aside className="shiply-route relative hidden w-[44%] max-w-[560px] flex-col overflow-hidden border-e border-line p-10 text-shiply-cream lg:flex">
        <div className="self-start"><LogoOnColor /></div>
        <div className="mt-auto max-w-sm">
          <p className="text-h1">{t('Next day delivery, from order to doorstep.')}</p>
          <p className="mt-4 text-body-lg opacity-90">{t('Pickups, sorting facilities, line haul and last mile in one system.')}</p>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex justify-end px-4 py-3"><PreferencesMenu /></div>
        <main className="flex flex-1 items-start justify-center px-4 pb-12 pt-6 sm:items-center">
          <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 shadow-md sm:p-8">
            <Logo size="lg" />
            <h1 className="mt-6 text-h3">{t('Sign in')}</h1>
            <p className="mt-1 text-body-sm text-text-muted">{t('Use your email or phone number')}</p>
            <div className="mt-5">
              <Suspense>
                <LoginForm />
              </Suspense>
            </div>
            <p className="mt-6 text-center text-body-sm text-text-muted">
              {t('New merchant?')} <Link href="/signup" className="font-bold text-link underline">{t('Open an account')}</Link>
            </p>
            <p className="mt-2 text-center text-body-sm text-text-muted">
              {t('Courier with an agent code?')} <Link href="/join" className="font-bold text-link underline">{t('Join here')}</Link>
            </p>
            <p className="mt-2 text-center text-body-sm text-text-muted">
              {t('Waiting for a parcel?')} <Link href="/track" className="font-bold text-link underline">{t('Track it here')}</Link>
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}
