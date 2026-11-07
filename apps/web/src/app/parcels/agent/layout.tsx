'use client';
import { DeskShell, type Me, type NavGroup } from '@/parcels/components/Shell';

const ROLES: Me['role'][] = ['AGENT'];

const groups = (me: Me): NavGroup[] => [
  {
    label: me.agent?.name,
    items: [
      { href: '/parcels/agent', label: 'Today', icon: 'home', exact: true },
      { href: '/parcels/agent/staff', label: 'Staff', icon: 'customers' },
      { href: '/parcels/agent/vehicles', label: 'Vehicles', icon: 'route' },
      { href: '/parcels/agent/settlements', label: 'Monthly settlements', icon: 'wallet' },
      { href: '/parcels/agent/tickets', label: 'Quality tickets', icon: 'alert' },
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
