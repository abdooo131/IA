'use client';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { TEAM_LABELS, TEAM_LABELS_AR } from '@shiply/shared';
import { appsFor } from '@/lib/apps';
import { api } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { AccountMenu } from './AccountMenu';
import { AppBar } from './AppBar';
import { AppHeader } from './AppHeader';
import { BottomTabs, type Tab } from './BottomTabs';
import { Logo } from './Logo';
import { SideNav, type NavGroup } from './SideNav';
import { Loading } from './ui';

export type { NavGroup, NavItem } from './SideNav';
export type { Tab } from './BottomTabs';

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
  merchantOwner: boolean;
  merchantRights: string[];
}

const MeContext = createContext<Me | null>(null);
export function useMe(): Me {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe outside a shell');
  return me;
}

/** Where each role lands after signing in. Team members with several apps get the apps home. */
export const HOME_BY_ROLE: Record<Me['role'], string> = {
  ADMIN: '/home',
  HUB_STAFF: '/hub',
  COURIER: '/courier',
  MERCHANT: '/merchant',
  AGENT: '/agent',
};

/** "Inbound team", "Supervisor", "Admin", with the place when there is one. */
export function useRoleText() {
  const me = useMe();
  const t = useT();
  const locale = useLocale();
  const role = me.team
    ? locale === 'ar' ? TEAM_LABELS_AR[me.team] : TEAM_LABELS[me.team]
    : me.role === 'HUB_STAFF' && me.hub?.isSorting ? t('Supervisor')
    : t({ ADMIN: 'Admin', HUB_STAFF: 'Hub staff', COURIER: 'Courier', MERCHANT: 'Merchant', AGENT: 'Agent' }[me.role]);
  const place = me.hub?.name ?? me.merchant?.name ?? me.agent?.name;
  return place ? `${role} · ${place}` : role;
}

/** Loads the signed in person; anyone of another role goes to their own home. */
export function Session({ roles, children }: { roles: Me['role'][]; children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const router = useRouter();
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
  if (!me) return <Loading />;
  return <MeContext.Provider value={me}>{children}</MeContext.Provider>;
}

function AppFrame({ badges, children }: { badges: (me: Me) => Promise<Record<string, number>>; children: ReactNode }) {
  const me = useMe();
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    badges(me).then(setCounts).catch(() => undefined);
  }, [me, badges]);
  return (
    <div className="min-h-dvh">
      <AppBar apps={appsFor(me)} badges={counts} />
      <main className="mx-auto w-full max-w-[1280px] px-4 py-6 lg:px-6 lg:py-8 print:max-w-none print:p-0">{children}</main>
    </div>
  );
}

const noBadges = async () => ({});

/** The frame of the team apps, as in Shiply Now: the app's menu bar across the top, the page below. */
export function AppShell({ roles, badges = noBadges, children }: { roles: Me['role'][]; badges?: (me: Me) => Promise<Record<string, number>>; children: ReactNode }) {
  return (
    <Session roles={roles}>
      <AppFrame badges={badges}>{children}</AppFrame>
    </Session>
  );
}

function DeskFrame({ groups, children }: { groups: (me: Me) => NavGroup[]; children: ReactNode }) {
  const me = useMe();
  const role = useRoleText();
  return (
    <div className="min-h-dvh lg:flex">
      <div className="contents print:hidden">
        <SideNav
          groups={groups(me)}
          brand={<Logo />}
          footer={
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-body-sm font-bold">{me.name}</p>
                <p className="truncate text-caption text-text-muted">{role}</p>
              </div>
              <AccountMenu up compact />
            </div>
          }
        />
      </div>
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[1280px] px-4 py-6 lg:px-6 lg:py-8 print:max-w-none print:p-0">{children}</div>
      </main>
    </div>
  );
}

/** The frame of the merchant and agent desks, as in Shiply Now: the side menu, the page beside it. */
export function DeskShell({ roles, groups, children }: { roles: Me['role'][]; groups: (me: Me) => NavGroup[]; children: ReactNode }) {
  return (
    <Session roles={roles}>
      <DeskFrame groups={groups}>{children}</DeskFrame>
    </Session>
  );
}

/** The phone screens (couriers), as in Shiply Now's store and rider screens: header, page, tabs. */
export function PhoneShell({ roles, tabs, children }: { roles: Me['role'][]; tabs: Tab[]; children: ReactNode }) {
  const t = useT();
  return (
    <Session roles={roles}>
      <div className="flex min-h-dvh flex-col">
        <AppHeader />
        <main className="mx-auto w-full max-w-xl flex-1 px-4 pb-28 pt-5">{children}</main>
        <BottomTabs label={t('Menu')} tabs={tabs} />
      </div>
    </Session>
  );
}
