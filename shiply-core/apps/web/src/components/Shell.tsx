'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { TEAM_LABELS } from '@shiply/shared';
import { api } from '@/lib/api';
import { cx, Loading } from './ui';

export interface Me {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'HUB_STAFF' | 'COURIER' | 'MERCHANT';
  team: 'INBOUND' | 'SORTING' | 'OUTBOUND' | null;
  hubId: string | null;
  merchantId: string | null;
  hub: { id: string; code: string; name: string; isSorting: boolean } | null;
  merchant: { id: string; code: string; name: string } | null;
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
};

/** App frame: loads the signed in user, checks the role, shows the navigation. */
type NavItem = { href: string; label: string };

/** `nav` may depend on who is signed in (a facility team sees only its station). */
export function Shell({ roles, nav: navFor, area, children }: { roles: Me['role'][]; nav: NavItem[] | ((me: Me) => NavItem[]); area: string; children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  // Depend on the role names, not the array, so a layout passing a new array each render
  // does not reload the user in a loop.
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

  const logout = async () => {
    await api('/auth/logout', { method: 'POST', body: {} });
    router.replace('/login');
  };

  const isActive = (href: string) => (href === nav[0]?.href ? pathname === href : pathname.startsWith(href));

  return (
    <MeContext.Provider value={me}>
      <header className="no-print sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <Link href={nav[0]?.href ?? '/'} className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-black text-white">S</span>
            <span className="text-sm font-bold leading-tight">
              Shiply Core
              <span className="block text-xs font-medium text-slate-500">{area}</span>
            </span>
          </Link>
          <nav className="ml-4 hidden flex-1 gap-1 lg:flex">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className={cx('rounded-lg px-3 py-2 text-sm font-medium', isActive(n.href) ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100')}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-3 lg:flex">
            <span className="text-right text-xs text-slate-600">
              <span className="block font-semibold text-slate-800">{me.name}</span>
              {me.hub?.name ?? me.merchant?.name ?? me.email}
              {me.team && <span className="block font-semibold text-brand-700">{TEAM_LABELS[me.team]}</span>}
            </span>
            <button onClick={logout} className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Sign out</button>
          </div>
          <button onClick={() => setOpen((o) => !o)} className="ml-auto rounded-lg p-2 text-slate-700 ring-1 ring-slate-300 lg:hidden" aria-label="Menu" aria-expanded={open}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 5h14M3 10h14M3 15h14" /></svg>
          </button>
        </div>
        {open && (
          <nav className="border-t border-slate-200 px-4 py-2 lg:hidden">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className={cx('block rounded-lg px-3 py-3 text-sm font-medium', isActive(n.href) ? 'bg-brand-50 text-brand-700' : 'text-slate-700')}>
                {n.label}
              </Link>
            ))}
            <div className="mt-2 flex items-center justify-between border-t border-slate-100 px-3 pt-3 text-sm">
              <span className="text-slate-600">{me.name}</span>
              <button onClick={logout} className="font-medium text-rose-700">Sign out</button>
            </div>
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-5 sm:py-6">{children}</main>
    </MeContext.Provider>
  );
}
