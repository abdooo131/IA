'use client';
import { Shell, type Me } from '@/components/Shell';

const NAV = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/shipments', label: 'Parcels' },
  { href: '/hub', label: 'Hub ops' },
  { href: '/admin/network', label: 'Network' },
  { href: '/admin/merchants', label: 'Merchants' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/money', label: 'Money' },
  { href: '/admin/settings', label: 'Settings' },
];
const ROLES: Me['role'][] = ['ADMIN'];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <Shell roles={ROLES} nav={NAV} area="Admin">
      {children}
    </Shell>
  );
}
