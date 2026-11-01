import { getTranslations } from 'next-intl/server';
import { getCurrentUser, getTheme } from '@/lib/server-session';
import { AccountMenu } from './AccountMenu';
import { Logo } from './Logo';

/** The top bar of the phone screens (store, rider, help, tickets): logo and one Settings menu. */
export async function AppHeader() {
  const [t, user, theme] = await Promise.all([
    getTranslations('common'),
    getCurrentUser(),
    getTheme(),
  ]);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
        <Logo alt={t('appName')} />
        <AccountMenu theme={theme} tickets={!!user && user.role !== 'merchant'} />
      </div>
    </header>
  );
}
