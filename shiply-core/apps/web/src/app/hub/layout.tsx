'use client';
import { Suspense } from 'react';
import { HubProvider } from '@/components/HubContext';
import { Shell } from '@/components/Shell';

const NAV = [
  { href: '/hub', label: 'Receive' },
  { href: '/hub/sort', label: 'Sort and bags' },
  { href: '/hub/trips', label: 'Trips' },
  { href: '/hub/runs', label: 'Courier runs' },
  { href: '/hub/pickups', label: 'Pickups' },
];

export default function HubLayout({ children }: { children: React.ReactNode }) {
  return (
    <Shell roles={['ADMIN', 'HUB_STAFF']} nav={NAV} area="Hub">
      <Suspense>
        <HubProvider>{children}</HubProvider>
      </Suspense>
    </Shell>
  );
}
