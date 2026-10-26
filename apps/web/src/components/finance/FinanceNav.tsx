'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/finance', key: 'overview' },
  { href: '/finance/cash', key: 'cash' },
  { href: '/finance/payouts', key: 'payouts' },
  { href: '/finance/merchants', key: 'merchants' },
  { href: '/finance/riders', key: 'riders' },
  { href: '/finance/journal', key: 'journal' },
  { href: '/finance/trial', key: 'trial' },
] as const;

export function FinanceNav() {
  const t = useTranslations('finance.nav');
  const pathname = usePathname();
  return (
    <nav className="border-b border-line bg-surface">
      <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4">
        {ITEMS.map((item) => {
          const active =
            item.href === '/finance' ? pathname === '/finance' : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`block whitespace-nowrap border-b-4 px-3 py-3 text-body-sm font-bold ${
                  active
                    ? 'border-primary text-link'
                    : 'border-transparent text-text-muted hover:text-text'
                }`}
              >
                {t(item.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
