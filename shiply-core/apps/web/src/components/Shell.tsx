'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { TEAM_LABELS, TEAM_LABELS_AR } from '@shiply/shared';
import { api } from '@/lib/api';
import { setPreference, useLocale, useT } from '@/lib/i18n';
import { Icon, type IconName } from './Icon';
import { Logo } from './Logo';
import { cx, Loading } from './ui';

export interface Me {
  id: string;
  name: string;
  email: string | null;
  role: 'ADMIN' | 'HUB_STAFF' | 'COURIER' | 'MERCHANT' | 'AGENT';
  team: 'INBOUND' | 'SORTING' | 'OUTBOUND' | null;
  hubId: string | null;
  merchantId: string | null;
  hub: { id: string; code: string; name: string; isSorting: boolean } | null;
  merchant: { id: string; code: string; name: string } | null;
  agentId: string | null;
  agent: { id: string; code: string; name: string } | null;
}

const MeContext = createContext<Me | null>(null);
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe outside Shell');
  return me;
}

export const HOME_BY_ROLE: Record<Me['role'], string> = {
  ADMIN: '/admin',
  HUB_STAFF: '/hub',
  COURIER: '/courier',
  MERCHANT: '/merchant',
  AGENT: '/agent',
};

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Group heading in the side menu. */
  group?: string;
}

function isActive(href: string, pathname: string, first: boolean) {
  if (first) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Prefs() {
  const t = useT();
  const locale = useLocale();
  const [theme, setTheme] = useState('system');
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme ?? 'system');
  }, []);
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      <select className="field min-h-9 py-1 text-caption" value={locale} onChange={(e) => setPreference('shiply_locale', e.target.value)} aria-label={t('Language')}>
        <option value="en">English</option>
        <option value="ar">العربية</option>
      </select>
      <select className="field min-h-9 py-1 text-caption" value={theme} onChange={(e) => setPreference('shiply_theme', e.target.value)} aria-label={t('Theme')}>
        <option value="system">{t('System')}</option>
        <option value="light">{t('Light')}</option>
        <option value="dark">{t('Dark')}</option>
      </select>
    </div>
  );
}

/**
 * App frame after Shiply Now: a Navy side menu with the brand icons on wide screens, a top bar
 * with a slide in menu on phones. Loads the signed in user and checks the role.
 */
export function Shell({ roles, nav: navFor, area, children }: { roles: Me['role'][]; nav: NavItem[] | ((me: Me) => NavItem[]); area: string; children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const t = useT();
  const locale = useLocale();

  // Depend on the role names, not the array, so a new array each render does not reload in a loop.
  const roleKey = roles.join(',');
  useEffect(() => {
    api<Me>('/auth/me')
      .then((user) => {
        if (!roleKey.split(',').includes(user.role)) router.replace(HOME_BY_ROLE[user.role]);
        else setMe(user);
      })
      .catch(() => undefined);
  }, [roleKey, router]);

  useEffect(() => setOpen(false), [pathname]);

  if (!me) return <Loading />;
  const nav = typeof navFor === 'function' ? navFor(me) : navFor;
  const groups: { label?: string; items: NavItem[] }[] = [];
  for (const item of nav) {
    const last = groups.at(-1);
    if (last && last.label === item.group) last.items.push(item);
    else groups.push({ label: item.group, items: [item] });
  }

  const logout = async () => {
    await api('/auth/logout', { method: 'POST', body: {} });
    router.replace('/login');
  };

  const roleText = me.team
    ? locale === 'ar' ? TEAM_LABELS_AR[me.team] : TEAM_LABELS[me.team]
    : me.role === 'HUB_STAFF' && me.hub?.isSorting ? t('Supervisor')
    : t({ ADMIN: 'Admin', HUB_STAFF: 'Hub staff', COURIER: 'Courier', MERCHANT: 'Merchant', AGENT: 'Agent' }[me.role]);

  return (
    <MeContext.Provider value={me}>
      <div className="min-h-dvh lg:flex">
        <div className="no-print sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface px-4 lg:hidden">
          <Logo />
          <button type="button" onClick={() => setOpen(true)} aria-expanded={open} className="flex h-11 items-center gap-2 rounded-md border border-line px-3 text-body-sm font-bold">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            {t('Menu')}
          </button>
        </div>
        {open && <div className="fixed inset-0 z-40 bg-[rgba(8,35,65,0.5)] lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}
        <aside
          aria-label={t('Menu')}
          className={cx(
            'no-print shiply-on-navy fixed inset-y-0 start-0 z-50 flex w-[272px] max-w-[85vw] flex-col border-e border-line bg-surface text-text shadow-lg transition-transform lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:w-[240px] lg:shadow-none',
            open ? '' : 'max-lg:ltr:-translate-x-full max-lg:rtl:translate-x-full',
          )}
        >
          <div className="flex h-16 items-center justify-between px-5">
            <Link href={nav[0]?.href ?? '/'}><Logo /></Link>
            <button type="button" onClick={() => setOpen(false)} aria-label={t('Close')} className="flex h-11 w-11 items-center justify-center rounded-md lg:hidden">
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          <p className="px-6 pb-2 text-label uppercase text-accent">{t(area)}</p>
          <nav className="flex-1 overflow-y-auto px-3 py-2">
            {groups.map((g, gi) => (
              <div key={gi} className="mb-3">
                {g.label && <p className="px-3 pb-1 pt-2 text-label uppercase text-text-muted">{t(g.label)}</p>}
                <ul className="space-y-0.5">
                  {g.items.map((item) => {
                    const active = isActive(item.href, pathname, item.href === nav[0]?.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={active ? 'page' : undefined}
                          className={cx('relative flex min-h-10 items-center gap-3 rounded-md px-3 text-body-sm font-semibold', active ? 'bg-selected-bg text-link' : 'text-text hover:bg-surface-raised')}
                        >
                          {active && <span aria-hidden="true" className="absolute inset-y-1.5 start-0 w-1 rounded-e bg-accent" />}
                          <Icon name={item.icon} size={20} selected={active} />
                          <span className="flex-1 truncate">{t(item.label)}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
          <div className="border-t border-line p-4">
            <p className="truncate text-body-sm font-bold">{me.name}</p>
            <p className="truncate text-caption text-text-muted">{me.hub?.name ?? me.merchant?.name ?? me.agent?.name ?? me.email ?? ''}</p>
            <p className="truncate text-caption font-bold text-accent">{roleText}</p>
            <Prefs />
            <button type="button" onClick={() => void logout()} className="btn-secondary mt-3 min-h-9 w-full text-caption">{t('Sign out')}</button>
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-[1280px] px-4 py-6 lg:px-8 lg:py-8 print:max-w-none print:p-0">{children}</div>
        </main>
      </div>
    </MeContext.Provider>
  );
}
