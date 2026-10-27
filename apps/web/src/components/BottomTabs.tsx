'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from './Icon';

export interface Tab {
  href: string;
  label: string;
  icon: IconName;
  exact?: boolean;
  badge?: number;
}

/**
 * The phone app tab bar from the handoff: the selected tab gets a 52 x 28 pill behind its
 * selected icon, and labels stay in the text color.
 */
export function BottomTabs({ tabs, label }: { tabs: Tab[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label={label}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-xl">
        {tabs.map((tab) => {
          const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className="flex min-h-16 flex-col items-center justify-center gap-1 text-caption font-semibold text-text"
              >
                <span
                  className={`relative flex h-7 w-[52px] items-center justify-center rounded-pill ${
                    active ? 'bg-selected-bg text-link' : ''
                  }`}
                >
                  <Icon name={tab.icon} size={24} selected={active} />
                  {!!tab.badge && (
                    <span className="ltr-iso absolute -top-1 end-0 min-w-5 rounded-pill bg-status-needs-action px-1 text-center text-[11px] font-bold leading-5 text-white">
                      {tab.badge}
                    </span>
                  )}
                </span>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
