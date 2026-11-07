'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Logo } from '@/components/Logo';
import { Alert, Button, Field, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { setPreference, useLocale, useT } from '@/lib/i18n';

/** Public: a courier registers with the code their agent gave them, then waits for approval. */
export default function JoinPage() {
  const t = useT();
  const locale = useLocale();
  const [f, setF] = useState({ agentCode: '', name: '', phone: '', password: '', courierType: 'DELIVERY' });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ agentName: string }>('/auth/join', { body: f });
      setDone(r.agentName);
    } catch (err) {
      setError(t(errorMessage(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <div className="flex items-center justify-between px-4 py-3">
        <Logo />
        <button type="button" className="btn-ghost min-h-9 text-caption" onClick={() => setPreference('shiply_locale', locale === 'ar' ? 'en' : 'ar')}>
          {locale === 'ar' ? 'English' : 'العربية'}
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm">
          <h1 className="text-h2">{t('Join as a courier')}</h1>
          <p className="mb-6 mt-1 text-body-sm text-text-muted">{t('Use the code your agent gave you. Your agent approves your account before you can sign in.')}</p>
          <div className="rounded-xl bg-surface p-6 shadow-md">
            {done ? (
              <div className="space-y-4">
                <Alert tone="success">{t('Registered with {agent}. You can sign in once your agent approves you.', { agent: done })}</Alert>
                <Link href="/login" className="btn-primary w-full">{t('Go to sign in')}</Link>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                {error && <Alert>{error}</Alert>}
                <Field label={t('Agent code')}>
                  <Input required className="ltr-iso uppercase" value={f.agentCode} onChange={(e) => setF({ ...f, agentCode: e.target.value })} />
                </Field>
                <Field label={t('Full name')}>
                  <Input required minLength={2} autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
                </Field>
                <Field label={t('Mobile number')}>
                  <Input required inputMode="tel" autoComplete="tel" className="ltr-iso" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
                </Field>
                <Field label={t('I will work in')}>
                  <Select value={f.courierType} onChange={(e) => setF({ ...f, courierType: e.target.value })}>
                    <option value="DELIVERY">{t('Delivery')}</option>
                    <option value="PICKUP">{t('Pickup')}</option>
                  </Select>
                </Field>
                <Field label={t('Password')} hint={t('8 characters or more')}>
                  <Input type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
                </Field>
                <Button type="submit" disabled={busy} className="w-full min-h-12 text-body">{t('Register')}</Button>
              </form>
            )}
          </div>
          <p className="mt-5 text-center text-body-sm text-text-muted">
            {t('Already approved?')} <Link href="/login" className="font-bold text-link">{t('Sign in')}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
