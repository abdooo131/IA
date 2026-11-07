import type { MerchantRightName } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { DashboardShell } from '@/components/DashboardShell';
import type { NavGroup, NavItem } from '@/components/SideNav';
import { apiGet, getMerchantRights } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

/** The right each menu item needs (docs/ACCESS.md); owners have every right. */
type Item = NavItem & { right?: MerchantRightName | 'owner' };

export default async function MerchantLayout({ children }: { children: ReactNode }) {
  const [me, access, t] = await Promise.all([
    apiGet<{ merchant: { name: string }; unreadNotifications: number }>('/merchant/me'),
    getMerchantRights(),
    getTranslations('merchant.nav'),
  ]);
  const items: Item[] = [
    { href: '/merchant', label: t('home'), icon: 'home', exact: true },
    { href: '/merchant/new', label: t('new'), icon: 'create', right: 'stock' },
    { href: '/merchant/orders', label: t('orders'), icon: 'orders', right: 'orders' },
    { href: '/merchant/products', label: t('products'), icon: 'products', right: 'stock' },
    { href: '/merchant/returns', label: t('returns'), icon: 'returns', right: 'stock' },
    { href: '/merchant/delivery', label: t('delivery'), icon: 'courier', right: 'settings' },
    { href: '/merchant/shopify', label: t('shopify'), icon: 'store', right: 'settings' },
    { href: '/merchant/wallet', label: t('wallet'), icon: 'wallet', right: 'money' },
    { href: '/merchant/invoices', label: t('invoices'), icon: 'invoice', right: 'money' },
    { href: '/merchant/contract', label: t('contract'), icon: 'invoice', right: 'money' },
    {
      href: '/merchant/notifications',
      label: t('notifications'),
      icon: 'notifications',
      badge: me.unreadNotifications,
    },
    { href: '/merchant/team', label: t('team'), icon: 'customers', right: 'owner' },
  ];
  const allowed = (right: Item['right']) =>
    !right || (right === 'owner' ? !!access?.owner : !!access?.rights.includes(right));
  const groups: NavGroup[] = [
    {
      label: me.merchant.name,
      items: items.filter((i) => allowed(i.right)).map(({ right: _right, ...item }) => item),
    },
  ];
  return <DashboardShell groups={groups}>{children}</DashboardShell>;
}
