'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/merchant', key: 'shipments' },
  { href: '/merchant/orders', key: 'orders' },
  { href: '/merchant/new', key: 'new' },
  { href: '/merchant/products', key: 'products' },
  { href: '/merchant/delivery', key: 'delivery' },
  { href: '/merchant/wallet', key: 'wallet' },
  { href: '/merchant/notifications', key: 'notifications' },
] as const;

export function MerchantNav({ unread }: { unread: number }) {
  const t = useTranslations('merchant.nav');
  const pathname = usePathname();
  return (
    <nav className="border-b border-line bg-surface">
      <ul className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4">
        {ITEMS.map((item) => {
          const active =
            item.href === '/merchant' ? pathname === '/merchant' : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-1.5 whitespace-nowrap border-b-4 px-3 py-3 text-body-sm font-bold ${
                  active
                    ? 'border-primary text-link'
                    : 'border-transparent text-text-muted hover:text-text'
                }`}
              >
                {t(item.key)}
                {item.key === 'notifications' && unread > 0 && (
                  <span className="ltr-iso rounded-pill bg-selected-bg px-2 text-caption text-link">
                    {unread}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
