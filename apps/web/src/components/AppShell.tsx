import type { ReactNode } from 'react';
import { appsFor } from '@/lib/apps';
import { getCurrentUser, getTheme } from '@/lib/server-session';
import { AccountMenu } from './AccountMenu';
import { AppBar } from './AppBar';

/**
 * The frame of the admin and finance apps: the app's menu bar across the top, the page below.
 * `badges` puts a count next to a page (and its menu), keyed by the page's address.
 */
export async function AppShell({
  badges = {},
  children,
}: {
  badges?: Record<string, number>;
  children: ReactNode;
}) {
  const [user, theme] = await Promise.all([getCurrentUser(), getTheme()]);
  const apps = appsFor(user?.role ?? 'finance');
  return (
    <div className="min-h-dvh">
      <AppBar apps={apps} badges={badges} account={<AccountMenu theme={theme} tickets compact />} />
      <main className="mx-auto w-full max-w-[1280px] px-4 py-6 lg:px-6 lg:py-8 print:max-w-none print:p-0">
        {children}
      </main>
    </div>
  );
}
