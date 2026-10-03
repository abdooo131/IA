'use client';

import { formatPiastres, OrderStatus, STATUS_GROUP_OF } from '@shiply/shared';
import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { useApp } from './app-context';
import { STATUS_LABELS } from './i18n';

const GROUP_STYLE: Record<string, string> = {
  NEW: 'bg-slate-100 text-slate-700 ring-slate-300',
  PENDING: 'bg-amber-50 text-amber-800 ring-amber-300',
  PROCESSING: 'bg-sky-50 text-sky-800 ring-sky-300',
  PAUSED: 'bg-orange-50 text-orange-800 ring-orange-300',
  SUCCESSFUL: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
  UNSUCCESSFUL: 'bg-rose-50 text-rose-800 ring-rose-300',
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const { lang } = useApp();
  const group = STATUS_GROUP_OF[status];
  return (
    <span
      data-status={status}
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${GROUP_STYLE[group]}`}
    >
      {STATUS_LABELS[lang][status]}
    </span>
  );
}

export function Money({ value, className = '' }: { value: number; className?: string }) {
  const { lang } = useApp();
  return <span className={`tabular-nums ${className}`}>{formatPiastres(value, lang)}</span>;
}

export function Card({ title, children, actions, className = '' }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Button({
  children,
  variant = 'primary',
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost' }) {
  const styles = {
    primary: 'bg-teal-700 text-white hover:bg-teal-800 disabled:bg-teal-700/50',
    secondary: 'bg-white text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:opacity-50',
    danger: 'bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50',
    ghost: 'text-teal-800 hover:bg-teal-50 disabled:opacity-50',
  }[variant];
  return (
    <button className={`inline-flex items-center justify-center gap-1 rounded-lg px-3 py-2 text-sm font-medium transition ${styles} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export const inputClass =
  'block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-teal-600';

export function Field({ label, children, error, hint }: { label: string; children: ReactNode; error?: string; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-700">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-rose-600">{error}</span>}
    </label>
  );
}

export function Spinner({ label }: { label?: string }) {
  const { t } = useApp();
  return <div className="py-10 text-center text-sm text-slate-500">{label ?? t.loading}</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return <div role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-200">{msg}</div>;
}

export function LoginScreen({ title, hint }: { title: string; hint?: ReactNode }) {
  const { login, t, lang, setLang } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError((err as Error).message || t.loginFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-teal-800">{title}</h1>
          <LangToggle lang={lang} setLang={setLang} />
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <Field label={t.email}>
            <input className={inputClass} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required name="email" />
          </Field>
          <Field label={t.password}>
            <input className={inputClass} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required name="password" />
          </Field>
          {error && <ErrorBox error={error} />}
          <Button type="submit" className="w-full" disabled={busy}>
            {t.login}
          </Button>
        </form>
        {hint && <div className="mt-4 text-xs text-slate-500">{hint}</div>}
      </div>
    </div>
  );
}

export function LangToggle({ lang, setLang }: { lang: 'en' | 'ar'; setLang: (l: 'en' | 'ar') => void }) {
  return (
    <button
      type="button"
      onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
      className="rounded-md px-2 py-1 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100"
      aria-label="Switch language"
    >
      {lang === 'en' ? 'العربية' : 'English'}
    </button>
  );
}

export interface NavItem {
  href: string;
  label: string;
}

/** Page frame: top bar with brand, navigation, language toggle and sign out. */
export function Shell({
  brand,
  nav,
  pathname,
  children,
  Link,
}: {
  brand: string;
  nav: NavItem[];
  pathname: string;
  children: ReactNode;
  Link: React.ComponentType<{ href: string; className?: string; children: ReactNode }>;
}) {
  const { session, logout, lang, setLang, t } = useApp();
  // The longest matching entry wins, so /orders/new does not also highlight /orders.
  const activeHref =
    nav
      .filter((n) => (n.href === '/' ? pathname === '/' : pathname === n.href || pathname.startsWith(n.href + '/')))
      .sort((a, b) => b.href.length - a.href.length)[0]?.href ?? '';
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="text-lg font-bold text-teal-800">{brand}</span>
          <nav className="flex flex-1 flex-wrap gap-1">
            {nav.map((n) => {
              const active = n.href === activeHref;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${active ? 'bg-teal-50 text-teal-800' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-600 sm:inline">{session?.user.fullName}</span>
            <LangToggle lang={lang} setLang={setLang} />
            <Button variant="secondary" onClick={() => logout()}>
              {t.logout}
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn()
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((x) => x + 1) };
}

export function formatDateTime(iso: string, lang: 'en' | 'ar') {
  return new Date(iso).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}
