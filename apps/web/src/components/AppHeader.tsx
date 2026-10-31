import { getTranslations } from 'next-intl/server';
import { getTheme } from '@/lib/server-session';
import { Logo } from './Logo';
import { PreferencesMenu } from './PreferencesMenu';
import { SignOutButton } from './SignOutButton';

export async function AppHeader() {
  const t = await getTranslations('common');
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Logo alt={t('appName')} />
        <div className="flex flex-wrap items-center gap-2">
          <PreferencesMenu theme={await getTheme()} help />
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
