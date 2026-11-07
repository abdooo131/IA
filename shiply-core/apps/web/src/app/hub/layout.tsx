'use client';
import { Suspense } from 'react';
import { HubProvider } from '@/components/HubContext';
import { Shell, type Me } from '@/components/Shell';

/**
 * A sorting facility has three stations, one per team: Inbound, Sorting, Outbound. A team member
 * sees only their station; supervisors (no team) and admins see every station plus pickups and
 * courier runs. A last mile hub has no teams.
 */
function navFor(me: Me) {
  if (me.role === 'HUB_STAFF' && me.hub && !me.hub.isSorting) {
    return [
      { href: '/hub', label: 'Receive' },
      { href: '/hub/runs', label: 'Courier runs' },
      { href: '/hub/sort', label: 'Send back' },
      { href: '/hub/trips', label: 'Trips' },
    ];
  }
  const all = [
    { href: '/hub', label: 'Inbound', team: 'INBOUND' },
    { href: '/hub/sort', label: 'Sorting', team: 'SORTING' },
    { href: '/hub/trips', label: 'Outbound', team: 'OUTBOUND' },
    { href: '/hub/runs', label: 'Courier runs', team: null },
    { href: '/hub/pickups', label: 'Pickups', team: null },
  ];
  return all.filter((n) => !me.team || n.team === me.team).map(({ href, label }) => ({ href, label }));
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
