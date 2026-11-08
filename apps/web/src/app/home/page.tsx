import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccountMenu } from '@/components/AccountMenu';
import { AppTileIcon } from '@/components/AppTileIcon';
import { Logo } from '@/components/Logo';
import { getMyProfile } from '@/lib/api-server';
import { appsFor } from '@/lib/apps';
import { getCurrentUser, getTheme } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

const tile =
  'flex h-full flex-col items-center gap-3 rounded-xl border border-line bg-surface px-3 py-6 text-center hover:border-primary hover:shadow-md';

/**
 * The apps a person may open, as tiles (Odoo style), in two groups: the operations of each
 * company (each with its floor screens as a menu) and the departments both share. An app shows when the person
 * may open one of its pages. Team members land here.
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
        {apps.length === 0 ? (
          <p className="mt-4 max-w-md text-center text-body text-text-muted">{t('home.none')}</p>
        ) : (
          <>
            <p className="mt-1 text-center text-body-sm text-text-muted">{t('home.intro')}</p>
            {(['operations', 'shared'] as const).map((group) => {
              const tiles = apps.filter((app) => app.group === group);
              if (tiles.length === 0) return null;
              return (
                <section key={group} className="mt-10 w-full">
                  <h2 className="mb-3 text-caption font-bold uppercase tracking-wide text-text-muted">
                    {t(`home.groups.${group}`)}
                  </h2>
                  <ul className="grid w-full grid-cols-2 gap-4 sm:grid-cols-3">
                    {tiles.map((app) => (
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
                  </ul>
                </section>
              );
            })}
          </>
        )}
      </main>
    </div>
  );
}
