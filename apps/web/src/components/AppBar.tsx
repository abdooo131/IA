'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { type AppDef, type AppMenu, type AppPage, locate } from '@/lib/apps';
import { AppTileIcon } from './AppTileIcon';

function GridIcon() {
  return (
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
  );
}

function Badge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="ltr-iso ms-2 rounded-pill bg-status-needs-action px-2 text-caption font-bold text-white">
      {count}
    </span>
  );
}

const menuCount = (menu: AppMenu, badges: Record<string, number>) =>
  menu.pages.reduce((sum, p) => sum + (badges[p.href] ?? 0), 0);

/**
 * The bar across the top of an app, Odoo style: the grid button back to all apps, the app's
 * name, and its menus. A menu with one page is a plain link; others open a short list.
 * On phones the menus fold into one Menu button that lists them all.
 */
export function AppBar({
  apps,
  badges,
  account,
}: {
  apps: AppDef[];
  badges: Record<string, number>;
  account: ReactNode;
}) {
  const t = useTranslations('apps');
  const pathname = usePathname();
  const here = locate(pathname);
  // Only apps this person may open; a page outside them still shows its area's app.
  const app = (here && apps.find((a) => a.id === here.app.id)) ?? apps[0] ?? null;
  const current: AppPage | null = here?.page ?? null;
  const [open, setOpen] = useState<string | null>(null);
  const [phone, setPhone] = useState(false);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(null);
    setPhone(false);
  }, [pathname]);
  useEffect(() => {
    if (!open && !phone) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(null);
      setPhone(false);
    };
    const onClick = (e: MouseEvent) => {
      if (bar.current && !bar.current.contains(e.target as Node)) {
        setOpen(null);
        setPhone(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open, phone]);

  const isCurrent = (page: AppPage) => current?.href === page.href;
  const menuActive = (menu: AppMenu) => menu.pages.some(isCurrent);
  const pageLabel = (page: AppPage) =>
    page.label === 'settings' ? t('pages.settings') : t(`pages.${page.label}`);
  // A one line description under a page in its menu (HR phase 1: the Configuration pages).
  const pageHint = (page: AppPage) => {
    const key = `hints.${page.label === 'settings' && app ? `${app.id}Settings` : page.label}`;
    return t.has(key) ? t(key) : null;
  };

  return (
    <div ref={bar} className="sticky top-0 z-30 border-b border-line bg-surface print:hidden">
      <div className="mx-auto flex min-h-14 w-full max-w-[1440px] items-center gap-1 px-2 lg:px-4">
        <Link
          href="/home"
          aria-label={t('home.allApps')}
          title={t('home.allApps')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-raised hover:text-text"
        >
          <GridIcon />
        </Link>
        {app && (
          <Link
            href={app.menus[0]!.pages[0]!.href}
            className="me-3 flex min-h-11 shrink-0 items-center gap-2 rounded-md px-1"
          >
            <AppTileIcon app={app} size="sm" />
            <span className="text-body font-bold">{t(`names.${app.id}`)}</span>
          </Link>
        )}

        {app && (
          <nav
            aria-label={t(`names.${app.id}`)}
            className="hidden flex-1 items-center gap-0.5 lg:flex"
          >
            {app.menus.map((menu) => {
              const active = menuActive(menu);
              const base = `flex h-11 items-center rounded-t-md border-b-2 px-3 text-body-sm font-semibold ${
                active
                  ? 'border-primary text-link'
                  : 'border-transparent text-text hover:bg-surface-raised'
              }`;
              if (menu.pages.length === 1 && menu.label !== 'configuration') {
                const page = menu.pages[0]!;
                return (
                  <Link
                    key={menu.label}
                    href={page.href}
                    aria-current={active ? 'page' : undefined}
                    className={base}
                  >
                    {t(`menus.${menu.label}`)}
                    <Badge count={badges[page.href] ?? 0} />
                  </Link>
                );
              }
              const isOpen = open === menu.label;
              return (
                <div key={menu.label} className="relative">
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : menu.label)}
                    aria-expanded={isOpen}
                    aria-haspopup="true"
                    className={`${base} ${isOpen ? 'bg-surface-raised' : ''}`}
                  >
                    {t(`menus.${menu.label}`)}
                    <Badge count={menuCount(menu, badges)} />
                    <svg
                      aria-hidden="true"
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      className="ms-1.5"
                    >
                      <path d="M3 4.5 6 7.5 9 4.5" />
                    </svg>
                  </button>
                  {isOpen && (
                    <ul className="absolute start-0 top-12 z-40 min-w-[260px] max-w-[320px] rounded-lg border border-line bg-surface p-1.5 shadow-lg">
                      {menu.pages.map((page) => (
                        <li key={page.href}>
                          <Link
                            href={page.href}
                            aria-current={isCurrent(page) ? 'page' : undefined}
                            className={`flex min-h-10 items-center justify-between rounded-md px-3 text-body-sm ${
                              isCurrent(page)
                                ? 'bg-selected-bg font-bold text-link'
                                : 'text-text hover:bg-surface-raised'
                            }`}
                          >
                            <span className="py-1.5">
                              {pageLabel(page)}
                              {pageHint(page) && (
                                <span className="block text-caption font-normal text-text-muted">
                                  {pageHint(page)}
                                </span>
                              )}
                            </span>
                            <Badge count={badges[page.href] ?? 0} />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </nav>
        )}

        <div className="ms-auto flex shrink-0 items-center gap-2">
          {app && (
            <button
              type="button"
              onClick={() => setPhone((v) => !v)}
              aria-expanded={phone}
              aria-controls="app-menu-phone"
              className="flex h-11 items-center gap-2 rounded-md border border-line px-3 text-body-sm font-bold lg:hidden"
            >
              <svg
                aria-hidden="true"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              >
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
              {t('home.menu')}
            </button>
          )}
          {account}
        </div>
      </div>

      {app && phone && (
        <nav
          id="app-menu-phone"
          aria-label={t(`names.${app.id}`)}
          className="max-h-[75dvh] overflow-y-auto border-t border-line px-4 pb-4 lg:hidden"
        >
          {app.menus.map((menu) => (
            <div key={menu.label} className="mt-3">
              <p className="px-3 pb-1 text-label uppercase text-text-muted">
                {t(`menus.${menu.label}`)}
              </p>
              <ul>
                {menu.pages.map((page) => (
                  <li key={page.href}>
                    <Link
                      href={page.href}
                      aria-current={isCurrent(page) ? 'page' : undefined}
                      className={`flex min-h-11 items-center justify-between rounded-md px-3 text-body-sm font-semibold ${
                        isCurrent(page) ? 'bg-selected-bg text-link' : 'text-text'
                      }`}
                    >
                      <span className="py-1.5">
                        {pageLabel(page)}
                        {pageHint(page) && (
                          <span className="block text-caption font-normal text-text-muted">
                            {pageHint(page)}
                          </span>
                        )}
                      </span>
                      <Badge count={badges[page.href] ?? 0} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      )}
    </div>
  );
}
