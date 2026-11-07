'use client';
import { PhoneShell, type Me, type Tab } from '@/components/Shell';
import { CheckInGate } from './CheckInGate';

const ROLES: Me['role'][] = ['COURIER'];
const TABS: Tab[] = [
  { href: '/courier', label: 'My run', icon: 'route', exact: true },
  { href: '/courier/pickups', label: 'Pickups', icon: 'pickups' },
  { href: '/courier/wallet', label: 'Wallet', icon: 'wallet' },
];

export default function CourierLayout({ children }: { children: React.ReactNode }) {
  return (
    <PhoneShell roles={ROLES} tabs={TABS}>
      <CheckInGate>{children}</CheckInGate>
    </PhoneShell>
  );
}
