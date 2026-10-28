import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { DashboardShell } from '@/components/DashboardShell';
import type { NavGroup } from '@/components/SideNav';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('admin');
  const groups: NavGroup[] = [
    {
      items: [
        { href: '/admin', label: t('nav.overview'), icon: 'home', exact: true },
        { href: '/admin/orders', label: t('nav.orders'), icon: 'orders' },
        { href: '/admin/alerts', label: t('nav.alerts'), icon: 'alert' },
      ],
    },
    {
      label: t('navGroups.stores'),
      items: [
        { href: '/admin/stores', label: t('nav.stores'), icon: 'store' },
        { href: '/admin/zones', label: t('nav.zones'), icon: 'route' },
        { href: '/admin/stock', label: t('nav.stock'), icon: 'inventory' },
        { href: '/admin/shipments', label: t('nav.shipments'), icon: 'pickups' },
        { href: '/admin/transfers', label: t('nav.transfers'), icon: 'route' },
        { href: '/admin/returns', label: t('nav.returns'), icon: 'returns' },
        { href: '/admin/damage', label: t('nav.damage'), icon: 'insurance' },
        { href: '/admin/counts', label: t('nav.counts'), icon: 'scan' },
      ],
    },
    {
      label: t('navGroups.merchants'),
      items: [
        { href: '/admin/merchants', label: t('nav.merchants'), icon: 'customers' },
        { href: '/admin/products', label: t('nav.products'), icon: 'products' },
        { href: '/admin/shopify', label: t('nav.shopify'), icon: 'store' },
      ],
    },
    {
      label: t('navGroups.system'),
      items: [
        { href: '/finance', label: t('nav.finance'), icon: 'wallet' },
        { href: '/admin/users', label: t('nav.users'), icon: 'account' },
        { href: '/admin/settings', label: t('nav.settings'), icon: 'settings' },
        { href: '/admin/audit', label: t('nav.audit'), icon: 'invoice' },
      ],
    },
  ];
  return <DashboardShell groups={groups}>{children}</DashboardShell>;
}
