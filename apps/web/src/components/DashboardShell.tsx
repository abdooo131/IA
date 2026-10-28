import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { getCurrentUser, getTheme } from '@/lib/server-session';
import { Logo } from './Logo';
import { PreferencesMenu } from './PreferencesMenu';
import { type NavGroup, SideNav } from './SideNav';
import { SignOutButton } from './SignOutButton';

/** The frame of the desk areas (admin, finance, merchant): sidebar on the side, page beside it. */
export async function DashboardShell({
  groups,
  children,
}: {
  groups: NavGroup[];
  children: ReactNode;
}) {
  const [t, user, theme] = await Promise.all([getTranslations(), getCurrentUser(), getTheme()]);
  return (
    <div className="min-h-dvh lg:flex">
      <SideNav
        groups={groups}
        brand={<Logo alt={t('common.appName')} />}
        footer={
          <div className="space-y-3">
            {user && (
              <div className="min-w-0">
                <p className="truncate text-body-sm font-bold">{user.name}</p>
                <p className="text-caption text-text-muted">{t(`roles.${user.role}`)}</p>
              </div>
            )}
            <PreferencesMenu theme={theme} help />
            <SignOutButton />
          </div>
        }
      />
      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-[1280px] px-4 py-6 lg:px-6 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
