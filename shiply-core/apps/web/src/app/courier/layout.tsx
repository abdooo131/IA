'use client';
import { Shell } from '@/components/Shell';

const NAV = [
  { href: '/courier', label: 'My run' },
  { href: '/courier/pickups', label: 'Pickups' },
];

export default function CourierLayout({ children }: { children: React.ReactNode }) {
  return (
    <Shell roles={['COURIER']} nav={NAV} area="Courier">
      <div className="mx-auto max-w-xl">{children}</div>
    </Shell>
  );
}
