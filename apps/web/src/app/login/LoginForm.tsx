'use client';

import { loginSchema, type PublicUser } from '@shiplynow/shared';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { homeFor } from '@/lib/access';

type ErrorKey =
  | 'invalid_credentials'
  | 'too_many_attempts'
  | 'validation'
  | 'network'
  | 'account_pending'
  | 'account_rejected';

const inputBase =
  'mt-1 block h-10 w-full rounded-md border bg-surface px-3 text-body text-text placeholder:text-text-muted';

export function LoginForm({ next }: { next: string | null }) {
  const t = useTranslations('login');
  const router = useRouter();
  const [error, setError] = useState<ErrorKey | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({
      email: form.get('email'),
      password: form.get('password'),
    });
    if (!parsed.success) {
      setError('validation');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (res.status === 403) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error === 'account_rejected' ? 'account_rejected' : 'account_pending');
        return;
      }
      if (!res.ok) {
        setError(
          res.status === 401
            ? 'invalid_credentials'
            : res.status === 429
              ? 'too_many_attempts'
              : res.status === 400
                ? 'validation'
                : 'network',
        );
        return;
      }
      const { user } = (await res.json()) as { user: PublicUser };
      router.replace(next ?? homeFor(user.role) ?? '/');
      router.refresh();
    } catch {
      setError('network');
    } finally {
      setSubmitting(false);
    }
  }

  const border = error ? 'border-danger' : 'border-line';

  // method="post": even if the form is sent before the script loads, the password never
  // lands in the address bar or a server log.
  return (
    <form className="mt-6 space-y-4" method="post" onSubmit={onSubmit} noValidate>
      <div>
        <label htmlFor="email" className="text-caption text-text">
          {t('email')}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          dir="ltr"
          required
          className={`${inputBase} ${border}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'login-error' : undefined}
        />
      </div>
      <div>
        <label htmlFor="password" className="text-caption text-text">
          {t('password')}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={`${inputBase} ${border}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'login-error' : undefined}
        />
      </div>
      {error && (
        <p id="login-error" role="alert" className="text-body-sm text-danger">
          {t(`errors.${error}`)}
        </p>
      )}
      <button
        type="submit"
        disabled={submitting}
        className="h-10 w-full rounded-md bg-primary px-4 font-bold text-on-primary active:bg-primary-pressed disabled:bg-[#E3E8EF] disabled:text-[#9AA6B8]"
      >
        {submitting ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}
