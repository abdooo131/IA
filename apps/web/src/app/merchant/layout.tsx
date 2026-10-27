import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { DashboardShell } from '@/components/DashboardShell';
import type { NavGroup } from '@/components/SideNav';
import { apiGet } from '@/lib/api-server';

export const dynamic = 'force-dynamic';

export default async function MerchantLayout({ children }: { children: ReactNode }) {
  const [me, t] = await Promise.all([
    apiGet<{ merchant: { name: string }; unreadNotifications: number }>('/merchant/me'),
    getTranslations('merchant.nav'),
  ]);
  const groups: NavGroup[] = [
    {
      label: me.merchant.name,
      items: [
        { href: '/merchant', label: t('home'), icon: 'home', exact: true },
        { href: '/merchant/new', label: t('new'), icon: 'create' },
        { href: '/merchant/orders', label: t('orders'), icon: 'orders' },
        { href: '/merchant/products', label: t('products'), icon: 'products' },
        { href: '/merchant/returns', label: t('returns'), icon: 'returns' },
        { href: '/merchant/delivery', label: t('delivery'), icon: 'courier' },
        { href: '/merchant/wallet', label: t('wallet'), icon: 'wallet' },
        {
          href: '/merchant/notifications',
          label: t('notifications'),
          icon: 'notifications',
          badge: me.unreadNotifications,
        },
      ],
    },
  ];
  return <DashboardShell groups={groups}>{children}</DashboardShell>;
}
