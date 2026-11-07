'use client';
import { Suspense } from 'react';
import { HubProvider } from '@/components/HubContext';
import { Shell, type Me, type NavItem } from '@/components/Shell';

/**
 * A sorting facility has three stations, one per team: Inbound, Sorting, Outbound. A team member
 * sees only their station; supervisors (no team) and admins see every station plus pickups and
 * courier runs. A last mile hub has no teams.
 */
function navFor(me: Me): NavItem[] {
  if (me.role === 'HUB_STAFF' && me.hub && !me.hub.isSorting) {
    return [
      { href: '/hub', label: 'Receive', icon: 'scan' },
      { href: '/hub/runs', label: 'Courier runs', icon: 'courier' },
      { href: '/hub/sort', label: 'Send back', icon: 'returns' },
      { href: '/hub/trips', label: 'Trips', icon: 'route' },
      { href: '/hub/check', label: 'Handover check', icon: 'alert' },
    ];
  }
  const all: (NavItem & { team: string | null })[] = [
    { href: '/hub', label: 'Inbound', icon: 'scan', team: 'INBOUND', group: 'Stations' },
    { href: '/hub/sort', label: 'Sorting', icon: 'packaging', team: 'SORTING', group: 'Stations' },
    { href: '/hub/trips', label: 'Outbound', icon: 'route', team: 'OUTBOUND', group: 'Stations' },
    { href: '/hub/pickups', label: 'Pickups', icon: 'pickups', team: null, group: 'Couriers' },
    { href: '/hub/runs', label: 'Courier runs', icon: 'courier', team: null, group: 'Couriers' },
    { href: '/hub/check', label: 'Handover check', icon: 'alert', team: 'ALL', group: 'Control' },
  ];
  const mine = all.filter((n) => !me.team || n.team === me.team || n.team === 'ALL').map(({ team: _team, ...n }) => n);
  if (me.role === 'ADMIN') mine.push({ href: '/admin', label: 'Back to admin', icon: 'home', group: 'Admin' });
  return mine;
}

export default function HubLayout({ children }: { children: React.ReactNode }) {
  return (
    <Shell roles={['ADMIN', 'HUB_STAFF']} nav={navFor} area="Operations">
      <Suspense>
        <HubProvider>{children}</HubProvider>
      </Suspense>
    </Shell>
  );
}
