'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Logo, LogoOnColor } from '@/components/Logo';
import { PreferencesMenu } from '@/components/PreferencesMenu';
import { Alert, Button, Field, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { useLocations } from '../merchant/locations';

/** A business opens an account: phone first (a 6 digit code), then its details. Operations approve it. */
export default function SignupPage() {
  const t = useT();
  const locale = useLocale();
  const { data: govs } = useLocations();
  const [step, setStep] = useState<'phone' | 'details' | 'done'>('phone');
  const [phone, setPhone] = useState('');
  const [f, setF] = useState({ code: '', businessName: '', contactName: '', email: '', password: '', pickupAddress: '', governorateCode: '', areaId: '', taxId: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const gov = (govs ?? []).find((g) => g.code === f.governorateCode);
  const name = (x: { nameEn: string; nameAr: string }) => (locale === 'ar' ? x.nameAr : x.nameEn);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(t(errorMessage(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-dvh bg-bg">
      <aside className="shiply-route relative hidden w-[44%] max-w-[560px] flex-col overflow-hidden border-e border-line p-10 text-shiply-cream lg:flex">
        <div className="self-start"><LogoOnColor /></div>
        <div className="mt-auto max-w-sm">
          <p className="text-h1">{t('Next day delivery, from order to doorstep.')}</p>
          <p className="mt-4 text-body-lg opacity-90">{t('Open an account in a few minutes. We call you to switch it on.')}</p>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex justify-end px-4 py-3"><PreferencesMenu /></div>
        <main className="flex flex-1 items-start justify-center px-4 pb-12 pt-6 sm:items-center">
          <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-md sm:p-8">
            <Logo size="lg" />
            <h1 className="mt-6 text-h3">{t('Open a merchant account')}</h1>
            {error && <div className="mt-4"><Alert>{error}</Alert></div>}
            {step === 'phone' && (
              <form className="mt-5 space-y-4" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/auth/signup/code', { body: { phone } }); setStep('details'); }); }}>
                <Field label={t('Mobile number')} hint={t('We send a 6 digit code to it')}><Input required inputMode="tel" className="ltr-iso" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
                <Button type="submit" className="w-full min-h-12" disabled={busy}>{t('Send the code')}</Button>
              </form>
            )}
            {step === 'details' && (
              <form className="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api('/auth/signup', { body: { ...f, phone, areaId: f.areaId || null } }); setStep('done'); }); }}>
                <Field label={t('Code from the message')} className="sm:col-span-2"><Input required inputMode="numeric" maxLength={6} className="ltr-iso" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
                <Field label={t('Business name')}><Input required value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} /></Field>
                <Field label={t('Your name')}><Input required value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></Field>
                <Field label={t('Email')}><Input type="email" required className="ltr-iso" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
                <Field label={t('Password')} hint={t('8 characters or more')}><Input type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
                <Field label={t('Governorate')}>
                  <Select required value={f.governorateCode} onChange={(e) => setF({ ...f, governorateCode: e.target.value, areaId: '' })}>
                    <option value="">{t('Choose…')}</option>
                    {(govs ?? []).map((g) => <option key={g.code} value={g.code}>{name(g)}</option>)}
                  </Select>
                </Field>
                <Field label={t('Area')} hint={t('Optional')}>
                  <Select value={f.areaId} onChange={(e) => setF({ ...f, areaId: e.target.value })}>
                    <option value="">{t('Any area')}</option>
                    {gov?.areas.map((a) => <option key={a.id} value={a.id}>{name(a)}</option>)}
                  </Select>
                </Field>
                <Field label={t('Pickup address')} className="sm:col-span-2"><Input required value={f.pickupAddress} onChange={(e) => setF({ ...f, pickupAddress: e.target.value })} /></Field>
                <Field label={t('Tax registration number')} hint={t('Optional, for companies')} className="sm:col-span-2"><Input className="ltr-iso" value={f.taxId} onChange={(e) => setF({ ...f, taxId: e.target.value })} /></Field>
                <Button type="submit" className="w-full min-h-12 sm:col-span-2" disabled={busy}>{t('Open my account')}</Button>
              </form>
            )}
            {step === 'done' && (
              <div className="mt-5 space-y-4">
                <Alert tone="success">{t('Thank you. We will call you and switch on your account')}</Alert>
                <Link href="/login" className="btn-primary w-full">{t('Go to sign in')}</Link>
              </div>
            )}
            <p className="mt-6 text-center text-body-sm text-text-muted">{t('Already have an account?')} <Link href="/login" className="font-bold text-link underline">{t('Sign in')}</Link></p>
          </div>
        </main>
      </div>
    </div>
  );
}
