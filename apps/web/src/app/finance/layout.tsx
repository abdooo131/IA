import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { DashboardShell } from '@/components/DashboardShell';
import { FINANCE_FAMILIES } from '@/components/finance/FinanceTabs';
import type { NavGroup } from '@/components/SideNav';
import { apiGet } from '@/lib/api-server';
import type { FinanceControls } from '@/lib/finance-types';
import { getCurrentUser } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

export default async function FinanceLayout({ children }: { children: ReactNode }) {
  const [t, ta, user, controls] = await Promise.all([
    getTranslations('finance.nav'),
    getTranslations('admin'),
    getCurrentUser(),
    apiGet<FinanceControls>('/finance/controls'),
  ]);
  const groups: NavGroup[] = [
    {
      label: t('groups.today'),
      alwaysOpen: true,
      items: [
        { href: '/finance', label: t('overview'), icon: 'home', exact: true },
        {
          href: '/finance/approvals',
          label: t('approvals'),
          icon: 'alert',
          badge: controls.waiting + controls.payoutsToApprove,
        },
        { href: '/finance/cash', label: t('cash'), icon: 'cash' },
        { href: '/finance/bank', label: t('bank'), icon: 'cash' },
        {
          href: '/finance/receipts',
          label: t('receipts'),
          icon: 'invoice',
          badge: controls.missingReceipts,
        },
      ],
    },
    {
      label: t('groups.merchants'),
      items: [
        { href: '/finance/merchants', label: t('merchants'), icon: 'customers' },
        { href: '/finance/payouts', label: t('payouts'), icon: 'payout' },
        { href: '/finance/invoices', label: t('invoices'), icon: 'invoice' },
        { href: '/finance/receivables', label: t('receivables'), icon: 'customers' },
      ],
    },
    {
      label: t('groups.spending'),
      items: [
        { href: '/finance/bills', label: t('bills'), icon: 'invoice' },
        { href: '/finance/movements', label: t('movements'), icon: 'payout' },
        { href: '/finance/recurring', label: t('recurring'), icon: 'schedule' },
        { href: '/finance/assets', label: t('assets'), icon: 'wallet' },
      ],
    },
    {
      label: t('groups.people'),
      items: [
        { href: '/finance/riders', label: t('riders'), icon: 'courier' },
        { href: '/finance/payroll', label: t('payroll'), icon: 'account' },
      ],
    },
    {
      label: t('groups.taxesReports'),
      items: [
        {
          href: '/finance/taxes',
          label: t('taxes'),
          icon: 'invoice',
          also: [...FINANCE_FAMILIES.taxes],
        },
        {
          href: '/finance/profit-and-loss',
          label: t('reports'),
          icon: 'analytics',
          also: [...FINANCE_FAMILIES.reports],
        },
      ],
    },
    {
      label: t('groups.setup'),
      items: [
        { href: '/finance/accounts', label: t('accounts'), icon: 'wallet' },
        { href: '/finance/company', label: t('company'), icon: 'store' },
        {
          href: '/finance/close',
          label: t('closing'),
          icon: 'schedule',
          also: [...FINANCE_FAMILIES.closing],
        },
        ...(user?.role === 'admin'
          ? [{ href: '/finance/opening', label: t('opening'), icon: 'wallet' as const }]
          : []),
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
