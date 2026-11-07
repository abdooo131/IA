'use client';
import { Shell, type Me, type NavItem } from '@/components/Shell';

const NAV: NavItem[] = [
  { href: '/agent', label: 'Today', icon: 'home' },
  { href: '/agent/staff', label: 'Staff', icon: 'customers' },
  { href: '/agent/vehicles', label: 'Vehicles', icon: 'route' },
];
const ROLES: Me['role'][] = ['AGENT'];

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  return (
    <Shell roles={ROLES} nav={NAV} area="Agent">
      {children}
    </Shell>
  );
}
