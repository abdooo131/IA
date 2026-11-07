'use client';
import { Shell, type Me , type NavItem } from '@/components/Shell';

const NAV: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: 'home' },
  { href: '/admin/shipments', label: 'Parcels', icon: 'orders' },
  { href: '/hub', label: 'Operations', icon: 'scan' },
  { href: '/admin/money', label: 'Money', icon: 'wallet' },
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
