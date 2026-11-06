import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { getMyProfile } from '@/lib/api-server';
import { appsFor } from '@/lib/apps';
import { getCurrentUser, getTheme } from '@/lib/server-session';
import { AccountMenu } from './AccountMenu';
import { Logo } from './Logo';

/**
 * The top bar of the phone screens (store, rider, help, tickets): logo and one Settings menu.
 * A team member who may open apps besides the store screens (a store manager) also gets the
 * grid button to the apps home.
 */
export async function AppHeader() {
  const [t, ta, user, theme] = await Promise.all([
    getTranslations('common'),
    getTranslations('apps'),
    getCurrentUser(),
    getTheme(),
  ]);
  const team = user && ['admin', 'finance', 'store_staff'].includes(user.role);
  const hasApps = team ? appsFor(await getMyProfile()).length > 0 : false;
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-2">
          {hasApps && (
            <Link
              href="/home"
              aria-label={ta('home.allApps')}
              title={ta('home.allApps')}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-raised hover:text-text"
            >
              <svg
                aria-hidden="true"
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <rect x="2" y="2" width="6" height="6" rx="1.5" />
                <rect x="12" y="2" width="6" height="6" rx="1.5" />
                <rect x="2" y="12" width="6" height="6" rx="1.5" />
                <rect x="12" y="12" width="6" height="6" rx="1.5" />
              </svg>
            </Link>
          )}
          <Logo alt={t('appName')} />
        </div>
        <AccountMenu theme={theme} tickets={!!user && user.role !== 'merchant'} />
      </div>
    </header>
  );
}
