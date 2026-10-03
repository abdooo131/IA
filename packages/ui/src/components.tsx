'use client';

import { formatPiastres, OrderStatus, STATUS_GROUP_OF } from '@shiply/shared';
import { FormEvent, ReactNode, SVGProps, useEffect, useState } from 'react';
import { useApp } from './app-context';
import { STATUS_LABELS } from './i18n';
import { IconAlert, IconBox, IconGlobe, IconLogout } from './icons';

const GROUP_STYLE: Record<string, { pill: string; dot: string }> = {
  NEW: { pill: 'bg-slate-100 text-slate-700', dot: 'bg-slate-400' },
  PENDING: { pill: 'bg-amber-50 text-amber-800', dot: 'bg-amber-500' },
  PROCESSING: { pill: 'bg-sky-50 text-sky-800', dot: 'bg-sky-500' },
  PAUSED: { pill: 'bg-orange-50 text-orange-800', dot: 'bg-orange-500' },
  SUCCESSFUL: { pill: 'bg-emerald-50 text-emerald-800', dot: 'bg-emerald-500' },
  UNSUCCESSFUL: { pill: 'bg-rose-50 text-rose-800', dot: 'bg-rose-500' },
};

export const GROUP_DOT = Object.fromEntries(Object.entries(GROUP_STYLE).map(([k, v]) => [k, v.dot])) as Record<string, string>;

export function StatusBadge({ status }: { status: OrderStatus }) {
  const { lang } = useApp();
  const style = GROUP_STYLE[STATUS_GROUP_OF[status]];
  return (
    <span data-status={status} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${style.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {STATUS_LABELS[lang][status]}
    </span>
  );
}

export function Money({ value, className = '' }: { value: number; className?: string }) {
  const { lang } = useApp();
  return <span className={`tabular whitespace-nowrap ${className}`}>{formatPiastres(value, lang)}</span>;
}

export function Card({ title, children, actions, className = '', flush }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={`rounded-xl border border-line bg-surface shadow-card ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={flush ? 'pt-3' : 'p-5'}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-text">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const BUTTON_STYLES = {
  primary: 'bg-accent text-white shadow-sm hover:bg-accent-strong disabled:opacity-50',
  secondary: 'bg-surface text-text ring-1 ring-inset ring-line hover:bg-paper disabled:opacity-50',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50',
  ghost: 'text-accent-strong hover:bg-accent-soft disabled:opacity-50',
  dark: 'bg-ink text-white hover:bg-ink-soft disabled:opacity-50',
} as const;

export function buttonClass(variant: keyof typeof BUTTON_STYLES = 'primary', extra = '') {
  return `inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${BUTTON_STYLES[variant]} ${extra}`;
}

export function Button({
  children,
  variant = 'primary',
  className = '',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON_STYLES }) {
  return (
    <button className={buttonClass(variant, className)} {...rest}>
      {children}
    </button>
  );
}

export const inputClass =
  'block w-full min-w-0 rounded-lg border-0 bg-surface px-3 py-2 text-sm text-text ring-1 ring-inset ring-line placeholder:text-muted/70 focus:ring-2 focus:ring-inset focus:ring-accent disabled:bg-paper disabled:text-muted';

export function Field({ label, children, error, hint }: { label: string; children: ReactNode; error?: string; hint?: string }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-medium text-rose-600">{error}</span>}
    </label>
  );
}

export function Spinner({ label }: { label?: string }) {
  const { t } = useApp();
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" />
      {label ?? t.loading}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-800 ring-1 ring-inset ring-rose-200">
      <IconAlert className="mt-0.5 shrink-0" width={16} height={16} />
      <span>{msg}</span>
    </div>
  );
}

/** Brand mark: a parcel tag with the Shiply wordmark. */
export function Brand({ product, light }: { product: string; light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-white">
        <IconBox width={18} height={18} />
      </span>
      <span className="leading-tight">
        <span className={`block font-display text-[15px] font-semibold ${light ? 'text-white' : 'text-text'}`}>Shiply</span>
        <span className={`block text-[11px] uppercase tracking-wider ${light ? 'text-white/60' : 'text-muted'}`}>{product}</span>
      </span>
    </div>
  );
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
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-ink p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <Brand product={title} light />
        <AwbMotif />
        <p className="max-w-sm text-sm text-white/60">Cairo · Giza · Alexandria · Delta · Upper Egypt</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center justify-between lg:justify-end">
            <span className="lg:hidden"><Brand product={title} /></span>
            <LangToggle lang={lang} setLang={setLang} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.login}</h1>
          <p className="mt-1 text-sm text-muted">{title}</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <Field label={t.email}>
              <input className={inputClass} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required name="email" id="email" dir="ltr" />
            </Field>
            <Field label={t.password}>
              <input className={inputClass} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required name="password" id="password" dir="ltr" />
            </Field>
            {error && <ErrorBox error={error} />}
            <Button type="submit" className="w-full py-2.5" disabled={busy}>
              {t.login}
            </Button>
          </form>
          {hint && <div className="mt-6 rounded-lg bg-surface px-3 py-2 text-xs text-muted ring-1 ring-inset ring-line">{hint}</div>}
        </div>
      </main>
    </div>
  );
}

/** Decorative airway bill, drawn with real AWB fields, for the sign in panel. */
function AwbMotif() {
  const bars = [3, 1, 2, 1, 1, 3, 2, 1, 3, 1, 1, 2, 3, 1, 2, 2, 1, 3, 1, 1, 2, 1, 3, 2, 1, 1, 3, 1, 2, 1, 2, 3, 1, 1, 2, 1, 3, 1, 2, 2, 1, 1, 3, 2, 1, 3, 1, 2];
  return (
    <div className="mx-auto w-full max-w-sm -rotate-3 rounded-xl bg-white p-5 text-ink shadow-lift" aria-hidden="true">
      <div className="flex items-center justify-between border-b border-dashed border-slate-300 pb-3">
        <span className="font-display text-lg font-bold">SHIPLY</span>
        <span className="rounded bg-ink px-2 py-1 font-mono text-xs font-medium text-white">MAADI</span>
      </div>
      <div className="mt-4 flex h-14 items-stretch">
        {bars.map((w, i) => (
          <span key={i} className={i % 2 ? 'bg-transparent' : 'bg-ink'} style={{ flex: w }} />
        ))}
      </div>
      <div className="mt-2 text-center font-mono text-sm tracking-widest">SHP0000010231</div>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-dashed border-slate-300 pt-3 text-xs">
        <div>
          <div className="text-slate-500">COD</div>
          <div className="font-display text-lg font-semibold">EGP 1,250.00</div>
        </div>
        <div>
          <div className="text-slate-500">Size</div>
          <div className="font-medium">35 × 40</div>
        </div>
      </div>
    </div>
  );
}

export function LangToggle({ lang, setLang, dark }: { lang: 'en' | 'ar'; setLang: (l: 'en' | 'ar') => void; dark?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium ${dark ? 'text-white/80 hover:bg-ink-soft hover:text-white' : 'text-text ring-1 ring-inset ring-line hover:bg-paper'}`}
      aria-label="Switch language"
    >
      <IconGlobe width={16} height={16} />
      {lang === 'en' ? 'العربية' : 'English'}
    </button>
  );
}

export interface NavItem {
  href: string;
  label: string;
  icon?: React.ComponentType<SVGProps<SVGSVGElement>>;
}

/** App frame: navy navigation rail on the start side (stacks on top on small screens), content on paper. */
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
  const initials = (session?.user.fullName ?? '?').split(' ').map((w) => w[0]).slice(0, 2).join('');
  return (
    <div className="min-h-screen">
      <aside className="flex flex-col bg-ink text-white lg:fixed lg:inset-y-0 lg:start-0 lg:z-20 lg:w-60">
        <div className="flex items-center justify-between px-5 py-5">
          <Brand product={brand} light />
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-1 lg:flex-col lg:overflow-visible">
          {nav.map((n) => {
            const active = n.href === activeHref;
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active ? 'bg-white/10 text-white shadow-[inset_3px_0_0_rgb(var(--accent))] rtl:shadow-[inset_-3px_0_0_rgb(var(--accent))]' : 'text-white/65 hover:bg-ink-soft hover:text-white'
                }`}
              >
                {Icon && <Icon className={active ? 'text-accent' : ''} />}
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="hidden border-t border-ink-line p-3 lg:block">
          <div className="flex items-center gap-3 px-2 py-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink-soft text-xs font-semibold">{initials}</span>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-medium">{session?.user.fullName}</div>
              <div className="truncate text-[11px] text-white/50">{session?.user.email}</div>
            </div>
          </div>
          <div className="mt-1 flex flex-wrap gap-1 whitespace-nowrap">
            <LangToggle lang={lang} setLang={setLang} dark />
            <button type="button" onClick={() => logout()} className="ms-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-white/70 hover:bg-ink-soft hover:text-white">
              <IconLogout width={16} height={16} />
              {t.logout}
            </button>
          </div>
        </div>
        <div className="flex items-center justify-end gap-1 border-t border-ink-line px-3 py-2 lg:hidden">
          <LangToggle lang={lang} setLang={setLang} dark />
          <button type="button" onClick={() => logout()} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-white/70 hover:bg-ink-soft">
            <IconLogout width={16} height={16} />
            {t.logout}
          </button>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 sm:px-8 sm:py-8 lg:ps-[calc(15rem+2rem)]">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
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
