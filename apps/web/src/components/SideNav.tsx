'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { Icon, type IconName } from './Icon';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Matches only this exact path (area home pages). */
  exact?: boolean;
  badge?: number;
}
export interface NavGroup {
  label?: string;
  items: NavItem[];
}

function isActive(item: NavItem, pathname: string) {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

function Links({ groups, onPick }: { groups: NavGroup[]; onPick?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-2">
      {groups.map((group, g) => (
        <div key={group.label ?? g} className="mb-3">
          {group.label && (
            <p className="px-3 pb-1 pt-2 text-label uppercase text-text-muted">{group.label}</p>
          )}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(item, pathname);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onPick}
                    aria-current={active ? 'page' : undefined}
                    className={`relative flex min-h-11 items-center gap-3 rounded-md px-3 text-body-sm font-semibold ${
                      active ? 'bg-selected-bg text-link' : 'text-text hover:bg-surface-raised'
                    }`}
                  >
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-1.5 start-0 w-1 rounded-e bg-primary"
                      />
                    )}
                    <Icon name={item.icon} size={20} selected={active} />
                    <span className="flex-1 truncate">{item.label}</span>
                    {!!item.badge && (
                      <span className="ltr-iso rounded-pill bg-status-needs-action px-2 text-caption font-bold text-white">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * The dashboard sidebar: fixed at 232 px on wide screens, a slide in menu on phones.
 * `brand` is the logo and `footer` holds the account and preference controls.
 */
export function SideNav({
  groups,
  brand,
  footer,
}: {
  groups: NavGroup[];
  brand: ReactNode;
  footer: ReactNode;
}) {
  const t = useTranslations('common');
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);

  return (
    <>
      {/* Phones and tablets: a top bar with the menu button. */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface px-4 lg:hidden">
        {brand}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="side-nav"
          className="flex h-11 items-center gap-2 rounded-md border border-line px-3 text-body-sm font-bold"
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
          {t('menu')}
        </button>
      </div>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-[rgba(19,41,75,0.45)] lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        id="side-nav"
        aria-label={t('menu')}
        className={`fixed inset-y-0 start-0 z-50 flex w-[272px] max-w-[85vw] flex-col border-e border-line bg-surface shadow-lg transition-transform lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:w-[232px] lg:shadow-none ${
          open ? '' : 'max-lg:ltr:-translate-x-full max-lg:rtl:translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between px-5">
          {brand}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t('close')}
            className="flex h-11 w-11 items-center justify-center rounded-md lg:hidden"
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
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <Links groups={groups} onPick={() => setOpen(false)} />
        <div className="border-t border-line p-4">{footer}</div>
      </aside>
    </>
  );
}
