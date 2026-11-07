'use client';
import { DeskShell, type Me, type NavGroup } from '@/components/Shell';

const ROLES: Me['role'][] = ['AGENT'];

const groups = (me: Me): NavGroup[] => [
  {
    label: me.agent?.name,
    items: [
      { href: '/agent', label: 'Today', icon: 'home', exact: true },
      { href: '/agent/staff', label: 'Staff', icon: 'customers' },
      { href: '/agent/vehicles', label: 'Vehicles', icon: 'route' },
      { href: '/agent/settlements', label: 'Monthly settlements', icon: 'wallet' },
      { href: '/agent/tickets', label: 'Quality tickets', icon: 'alert' },
    ],
  },
];

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  return (
    <DeskShell roles={ROLES} groups={groups}>
      {children}
    </DeskShell>
  );
}
