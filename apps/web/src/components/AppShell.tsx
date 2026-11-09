import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PATHNAME_HEADER } from '@/lib/access';
import { getMyAccess } from '@/lib/api-server';
import { appsFor, canOpenPath } from '@/lib/apps';
import { getTheme } from '@/lib/server-session';
import { AccountMenu } from './AccountMenu';
import { AppBar } from './AppBar';

/**
 * The frame of the admin and finance apps: the app's menu bar across the top, the page below.
 * Menus show only the pages the person's access opens (GET /me/access); a page on a menu they
 * may not use shows not found. `badges` puts a count next to a page (and its menu), keyed by
 * the page's address.
 */
export async function AppShell({
  badges = {},
  search,
  children,
}: {
  badges?: Record<string, number>;
  /** The app's one search in the top bar (Accounting) */
  search?: ReactNode;
  children: ReactNode;
}) {
  const [access, theme, head] = await Promise.all([getMyAccess(), getTheme(), headers()]);
  const pathname = head.get(PATHNAME_HEADER);
  // No access answer means the session ended (the access token expired between the middleware
  // check and this page): ask to sign in again rather than show not found.
  if (!access) redirect(`/login?next=${encodeURIComponent(pathname ?? '/home')}`);
  const profile = access.kind === 'team' ? access.profile : null;
  if (pathname && !canOpenPath(profile, pathname)) notFound();
  const apps = appsFor(profile);
  return (
    <div className="min-h-dvh">
      <AppBar
        apps={apps}
        badges={badges}
        search={search}
        account={<AccountMenu theme={theme} tickets compact />}
      />
      <main className="mx-auto w-full max-w-[1280px] px-4 py-6 lg:px-6 lg:py-8 print:max-w-none print:p-0">
        {children}
      </main>
    </div>
  );
}
