'use client';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { atLeast, type AppId, type Level } from '@shiply/shared';
import { Link, usePathname } from '@/i18n/routing';
import { NoAccess } from './NoAccess';
import { TopBar } from './TopBar';
import { useMe } from './me';

export interface MenuItem {
  /** i18n key */
  label: string;
  href?: string;
  /** a dropdown group */
  items?: MenuItem[];
}

const INLINE = 7;

/** The inside of every app: the app's pages in one row beside the logo, More ▾ after 7. */
export function AppShell({ app, menu, need = 'view', children }: { app: AppId; menu: MenuItem[]; need?: Level; children: ReactNode }) {
  const t = useTranslations();
  const me = useMe();
  const path = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const [phoneOpen, setPhoneOpen] = useState(false);
  if (!atLeast(me.access[app], need)) {
    return (
      <>
        <TopBar />
        <NoAccess app={app} />
      </>
    );
  }
  const inline = menu.length > INLINE ? menu.slice(0, INLINE) : menu;
  const more = menu.length > INLINE ? menu.slice(INLINE) : [];
  const groups = more.length ? [...inline, { label: 'common.more', items: more }] : inline;
  // The app's own root (its Overview) is active only on itself, not on every page below it.
  const isActive = (href?: string) => !!href && (path === href || (href.split('/').length > 2 && path.startsWith(href + '/')));
  return (
    <>
      <TopBar>
        <nav className="appmenu" aria-label={t(`apps.${app}`)}>
          <span className="appname">› {t(`apps.${app}`)}</span>
          <button className="btn ghost phone-only" onClick={() => setPhoneOpen((o) => !o)} aria-expanded={phoneOpen}>
            ☰
          </button>
          <ul className={phoneOpen ? 'open' : ''}>
            {groups.map((m) =>
              m.items ? (
                <li key={m.label} className="menu-anchor" data-testid={m.label === 'common.more' ? 'more' : undefined}>
                  <button className="menu-link" onClick={() => setOpen(open === m.label ? null : m.label)} aria-expanded={open === m.label}>
                    {t(m.label)} ▾
                  </button>
                  {open === m.label && (
                    <ul className="dropdown" role="menu">
                      {m.items.map((s) => (
                        <li key={s.label}>
                          <Link href={s.href ?? '#'} onClick={() => setOpen(null)}>
                            {t(s.label)}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ) : (
                <li key={m.label} data-testid="menu-item">
                  <Link href={m.href ?? '#'} className={`menu-link${isActive(m.href) ? ' active' : ''}`}>
                    {t(m.label)}
                  </Link>
                </li>
              ),
            )}
          </ul>
        </nav>
      </TopBar>
      <main className="page">{children}</main>
    </>
  );
}
