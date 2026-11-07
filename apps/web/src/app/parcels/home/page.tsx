'use client';
import Link from 'next/link';
import { AccountMenu } from '@/parcels/components/AccountMenu';
import { AppTileIcon } from '@/parcels/components/AppTileIcon';
import { Logo } from '@/parcels/components/Logo';
import { Session, useMe, type Me } from '@/parcels/components/Shell';
import { appsFor } from '@/parcels/lib/apps';
import { useT } from '@/parcels/lib/i18n';

const ROLES: Me['role'][] = ['ADMIN', 'HUB_STAFF'];
const tile = 'flex h-full flex-col items-center gap-3 rounded-xl border border-line bg-surface px-3 py-6 text-center hover:border-primary hover:shadow-md';

function Home() {
  const t = useT();
  const me = useMe();
  const apps = appsFor(me);
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex min-h-14 w-full max-w-[1440px] items-center justify-between gap-3 px-4">
          <Logo />
          <AccountMenu compact />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center px-4 py-12">
        <h1 className="text-h2">{t('Hello {name}', { name: me.name })}</h1>
        <p className="mt-1 text-center text-body-sm text-text-muted">{t('Pick an app. The grid button at the top left of every app brings you back here.')}</p>
        <ul className="mt-10 grid w-full grid-cols-2 gap-4 sm:grid-cols-3">
          {apps.map((app) => (
            <li key={app.id}>
              <Link href={app.menus[0]!.pages[0]!.href} className={tile}>
                <AppTileIcon app={app} size="lg" />
                <span className="text-body font-bold">{t(app.name)}</span>
                <span className="text-caption text-text-muted">{t(app.description)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}

/** The apps a person may open, as tiles, the same as Shiply Now's home. Team members land here. */
export default function HomePage() {
  return (
    <Session roles={ROLES}>
      <Home />
    </Session>
  );
}
