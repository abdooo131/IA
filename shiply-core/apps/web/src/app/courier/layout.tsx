'use client';
import { Shell , type NavItem } from '@/components/Shell';
import { CheckInGate } from './CheckInGate';

const NAV: NavItem[] = [
  { href: '/courier', label: 'My run', icon: 'route' },
  { href: '/courier/pickups', label: 'Pickups', icon: 'pickups' },
];

export default function CourierLayout({ children }: { children: React.ReactNode }) {
  return (
    <Shell roles={['COURIER']} nav={NAV} area="Courier">
      <div className="mx-auto max-w-xl">
        <CheckInGate>{children}</CheckInGate>
      </div>
    </Shell>
  );
}
