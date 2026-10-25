'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/admin', key: 'overview' },
  { href: '/admin/orders', key: 'orders' },
  { href: '/admin/alerts', key: 'alerts' },
  { href: '/admin/zones', key: 'zones' },
  { href: '/admin/products', key: 'products' },
  { href: '/admin/stock', key: 'stock' },
  { href: '/admin/shipments', key: 'shipments' },
  { href: '/admin/counts', key: 'counts' },
] as const;

export function AdminNav() {
  const t = useTranslations('admin.nav');
  const pathname = usePathname();
  return (
    <nav className="border-b border-line bg-surface">
      <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4">
        {ITEMS.map((item) => {
          const active =
            item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
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
