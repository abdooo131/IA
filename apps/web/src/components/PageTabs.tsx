'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface PageTab {
  href: string;
  label: string;
}

/**
 * Sibling pages shown as tabs, so one menu link opens a family of related pages (Odoo
 * style). Each tab keeps its own address, so old links still work.
 */
export function PageTabs({ tabs }: { tabs: PageTab[] }) {
  const pathname = usePathname();
  return (
    <nav className="-mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-line print:hidden">
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`whitespace-nowrap border-b-2 px-3 pb-2 pt-1 text-body-sm font-semibold ${
              active
                ? 'border-primary text-link'
                : 'border-transparent text-text-muted hover:text-text'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
