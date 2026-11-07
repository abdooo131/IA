import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccountMenu } from '@/components/AccountMenu';
import { AppTileIcon } from '@/components/AppTileIcon';
import { Logo } from '@/components/Logo';
import { getMyProfile } from '@/lib/api-server';
import { appsFor, canOpenStoreScreens, PARCELS_TILE, STORE_TILE } from '@/lib/apps';
import { getCurrentUser, getTheme } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

const tile =
  'flex h-full flex-col items-center gap-3 rounded-xl border border-line bg-surface px-3 py-6 text-center hover:border-primary hover:shadow-md';

/**
 * The apps a person may open, as tiles (Odoo style): an app shows from view on it (Settings
 * from settings manage), and the store screens from store use. Team members land here.
 */
export default async function HomePage() {
  const [user, profile, theme, t, tc] = await Promise.all([
    getCurrentUser(),
    getMyProfile(),
    getTheme(),
    getTranslations('apps'),
    getTranslations('common'),
  ]);
  if (!user) redirect('/login?next=/home');
  const apps = appsFor(profile);
  const store = canOpenStoreScreens(profile);
  const parcels = user?.role === 'admin' || user?.role === 'finance';
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex min-h-14 w-full max-w-[1440px] items-center justify-between gap-3 px-4">
          <Logo alt={tc('appName')} />
          <AccountMenu theme={theme} tickets compact />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center px-4 py-12">
        <h1 className="text-h2">{t('home.title', { name: user.name })}</h1>
        {apps.length === 0 && !store && !parcels ? (
          <p className="mt-4 max-w-md text-center text-body text-text-muted">{t('home.none')}</p>
        ) : (
          <>
            <p className="mt-1 text-center text-body-sm text-text-muted">{t('home.intro')}</p>
            <ul className="mt-10 grid w-full grid-cols-2 gap-4 sm:grid-cols-3">
              {apps.map((app) => (
                <li key={app.id}>
                  <Link href={app.menus[0]!.pages[0]!.href} className={tile}>
                    <AppTileIcon app={app} size="lg" />
                    <span className="text-body font-bold">{t(`names.${app.id}`)}</span>
                    <span className="text-caption text-text-muted">
                      {t(`descriptions.${app.id}`)}
                    </span>
                  </Link>
                </li>
              ))}
              {store && (
                <li>
                  <Link href={STORE_TILE.href} className={tile}>
                    <AppTileIcon app={STORE_TILE} size="lg" />
                    <span className="text-body font-bold">{t('names.store')}</span>
                    <span className="text-caption text-text-muted">{t('descriptions.store')}</span>
                  </Link>
                </li>
              )}
              {parcels && (
                <li>
                  <Link href={PARCELS_TILE.href} className={tile}>
                    <AppTileIcon app={PARCELS_TILE} size="lg" />
                    <span className="text-body font-bold">{t('names.parcels')}</span>
                    <span className="text-caption text-text-muted">
                      {t('descriptions.parcels')}
                    </span>
                  </Link>
                </li>
              )}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
