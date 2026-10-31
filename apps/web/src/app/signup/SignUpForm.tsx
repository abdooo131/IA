'use client';

import { signUpSchema } from '@shiplynow/shared';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { apiSend } from '@/lib/api-client';

const field =
  'mt-1 block h-10 w-full rounded-md border border-line bg-surface px-3 text-body text-text';
const KNOWN = ['email_taken', 'phone_taken', 'too_many_attempts', 'validation', 'network'];

export function SignUpForm() {
  const t = useTranslations('signup');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | 'approved' | 'pending'>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = signUpSchema.safeParse({
      businessName: form.get('businessName'),
      contactName: form.get('contactName'),
      email: form.get('email'),
      phone: form.get('phone'),
      password: form.get('password'),
      shopDomain: (form.get('shopDomain') as string).trim() || undefined,
    });
    if (!parsed.success) {
      const path = parsed.error.issues[0]?.path[0];
      return setError(
        path === 'phone'
          ? 'phone_invalid'
          : path === 'password'
            ? 'password_short'
            : path === 'shopDomain'
              ? 'shop_invalid'
              : 'validation',
      );
    }
    setBusy(true);
    setError(null);
    const result = await apiSend<{ status: 'approved' | 'pending' }>(
      'POST',
      '/auth/signup',
      parsed.data,
    );
    setBusy(false);
    if (result.ok) return setDone(result.data.status === 'approved' ? 'approved' : 'pending');
    setError(
      result.error === 'http_429'
        ? 'too_many_attempts'
        : KNOWN.includes(result.error)
          ? result.error
          : 'generic',
    );
  }

  if (done)
    return (
      <p
        role="status"
        className="mt-6 rounded-md border border-line bg-surface-raised p-4 text-body"
      >
        {done === 'approved' ? t('doneApproved') : t('done')}{' '}
        {done === 'approved' && (
          <a href="/login" className="font-semibold underline">
            {t('signIn')}
          </a>
        )}
      </p>
    );

  return (
    <form className="mt-6 space-y-4" method="post" onSubmit={submit} noValidate>
      <label className="block text-caption">
        {t('businessName')}
        <input name="businessName" required maxLength={120} className={field} />
      </label>
      <label className="block text-caption">
        {t('contactName')}
        <input name="contactName" required maxLength={120} autoComplete="name" className={field} />
      </label>
      <label className="block text-caption">
        {t('email')}
        <input
          name="email"
          type="email"
          required
          dir="ltr"
          autoComplete="email"
          className={field}
        />
      </label>
      <label className="block text-caption">
        {t('phone')}
        <input
          name="phone"
          type="tel"
          required
          dir="ltr"
          autoComplete="tel"
          placeholder="010 1234 5678"
          className={field}
        />
      </label>
      <label className="block text-caption">
        {t('password')}
        <input
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          className={field}
        />
      </label>
      <label className="block text-caption">
        {t('shopDomain')}
        <input
          name="shopDomain"
          dir="ltr"
          placeholder="your-store.myshopify.com"
          className={field}
        />
      </label>
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          {t(`errors.${error}`)}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="h-10 w-full rounded-md bg-primary px-4 font-bold text-on-primary active:bg-primary-pressed disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]"
      >
        {t('submit')}
      </button>
    </form>
  );
}
