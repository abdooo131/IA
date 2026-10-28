import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { DashboardShell } from '@/components/DashboardShell';
import type { NavGroup } from '@/components/SideNav';
import { getCurrentUser } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

export default async function FinanceLayout({ children }: { children: ReactNode }) {
  const [t, ta, user] = await Promise.all([
    getTranslations('finance.nav'),
    getTranslations('admin'),
    getCurrentUser(),
  ]);
  const groups: NavGroup[] = [
    {
      items: [
        { href: '/finance', label: t('overview'), icon: 'home', exact: true },
        { href: '/finance/cash', label: t('cash'), icon: 'cash' },
        { href: '/finance/payouts', label: t('payouts'), icon: 'payout' },
        { href: '/finance/merchants', label: t('merchants'), icon: 'customers' },
        { href: '/finance/riders', label: t('riders'), icon: 'courier' },
      ],
    },
    {
      label: ta('navGroups.books'),
      items: [
        { href: '/finance/accounts', label: t('accounts'), icon: 'wallet' },
        { href: '/finance/movements', label: t('movements'), icon: 'payout' },
        { href: '/finance/journal', label: t('journal'), icon: 'invoice' },
        { href: '/finance/trial', label: t('trial'), icon: 'analytics' },
        { href: '/finance/profit-and-loss', label: t('pl'), icon: 'analytics' },
        { href: '/finance/balance-sheet', label: t('bs'), icon: 'invoice' },
      ],
    },
  ];
  // Admins can open finance too; give them the way back.
  if (user?.role === 'admin')
    groups.push({
      items: [{ href: '/admin', label: ta('nav.backToAdmin'), icon: 'home', exact: true }],
    });
  return <DashboardShell groups={groups}>{children}</DashboardShell>;
}
