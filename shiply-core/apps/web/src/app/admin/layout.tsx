'use client';
import { Shell, type Me , type NavItem } from '@/components/Shell';

const NAV: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: 'home' },
  { href: '/admin/shipments', label: 'Parcels', icon: 'orders' },
  { href: '/hub', label: 'Operations', icon: 'scan' },
  { href: '/admin/money', label: 'Money overview', icon: 'wallet', group: 'Money' },
  { href: '/admin/money/payouts', label: 'Merchant payouts', icon: 'payout', group: 'Money' },
  { href: '/admin/money/couriers', label: 'Courier wallets', icon: 'cash', group: 'Money' },
  { href: '/admin/money/safes', label: 'Hub safes', icon: 'invoice', group: 'Money' },
  { href: '/admin/money/agents', label: 'Agent settlements', icon: 'points', group: 'Money' },
  { href: '/admin/money/expenses', label: 'Expenses', icon: 'products', group: 'Money' },
  { href: '/admin/money/books', label: 'Books and reports', icon: 'analytics', group: 'Money' },
  { href: '/admin/agents', label: 'Agents', icon: 'courier', group: 'Workforce' },
  { href: '/admin/attendance', label: 'Attendance', icon: 'schedule', group: 'Workforce' },
  { href: '/admin/alerts', label: 'Alerts', icon: 'alert', group: 'Workforce' },
  { href: '/admin/vehicle-requests', label: 'Vehicle requests', icon: 'pickups', group: 'Workforce' },
  { href: '/admin/network', label: 'Network', icon: 'route', group: 'Setup' },
  { href: '/admin/merchants', label: 'Merchants', icon: 'store', group: 'Setup' },
  { href: '/admin/users', label: 'Users', icon: 'customers', group: 'Setup' },
  { href: '/admin/settings', label: 'Settings', icon: 'settings', group: 'Setup' },
];
const ROLES: Me['role'][] = ['ADMIN'];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Shell roles={ROLES} nav={NAV} area="Admin">
      {children}
    </Shell>
  );
}
