import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { DashboardShell } from '@/components/DashboardShell';
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
      items: [
        { href: '/finance', label: t('overview'), icon: 'home', exact: true },
        { href: '/finance/cash', label: t('cash'), icon: 'cash' },
        { href: '/finance/payouts', label: t('payouts'), icon: 'payout' },
        { href: '/finance/merchants', label: t('merchants'), icon: 'customers' },
        { href: '/finance/riders', label: t('riders'), icon: 'courier' },
        { href: '/finance/payroll', label: t('payroll'), icon: 'account' },
        { href: '/finance/invoices', label: t('invoices'), icon: 'invoice' },
        { href: '/finance/bills', label: t('bills'), icon: 'invoice' },
        { href: '/finance/receivables', label: t('receivables'), icon: 'customers' },
        {
          href: '/finance/approvals',
          label: t('approvals'),
          icon: 'alert',
          badge: controls.waiting + controls.payoutsToApprove,
        },
        {
          href: '/finance/receipts',
          label: t('receipts'),
          icon: 'invoice',
          badge: controls.missingReceipts,
        },
      ],
    },
    {
      label: ta('navGroups.books'),
      items: [
        { href: '/finance/accounts', label: t('accounts'), icon: 'wallet' },
        { href: '/finance/bank', label: t('bank'), icon: 'cash' },
        { href: '/finance/movements', label: t('movements'), icon: 'payout' },
        { href: '/finance/journal', label: t('journal'), icon: 'invoice' },
        { href: '/finance/trial', label: t('trial'), icon: 'analytics' },
        { href: '/finance/profit-and-loss', label: t('pl'), icon: 'analytics' },
        { href: '/finance/profit', label: t('profit'), icon: 'analytics' },
        { href: '/finance/balance-sheet', label: t('bs'), icon: 'invoice' },
        { href: '/finance/taxes', label: t('taxes'), icon: 'invoice' },
        { href: '/finance/vat', label: t('vat'), icon: 'invoice' },
        { href: '/finance/budgets', label: t('budgets'), icon: 'analytics' },
        { href: '/finance/money-flow', label: t('cashFlow'), icon: 'analytics' },
        { href: '/finance/recurring', label: t('recurring'), icon: 'schedule' },
        { href: '/finance/assets', label: t('assets'), icon: 'wallet' },
        { href: '/finance/close', label: t('close'), icon: 'schedule' },
        { href: '/finance/year-end', label: t('yearEnd'), icon: 'schedule' },
        { href: '/finance/company', label: t('company'), icon: 'store' },
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
