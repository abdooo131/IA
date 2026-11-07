'use client';
import { PhoneShell, type Me, type Tab } from '@/parcels/components/Shell';
import { useEffect } from 'react';
import { registerOfflineShell, useLocationPing } from '@/parcels/lib/courier-sync';
import { useT } from '@/parcels/lib/i18n';
import { CheckInGate } from './CheckInGate';

const ROLES: Me['role'][] = ['COURIER'];
const TABS: Tab[] = [
  { href: '/parcels/courier', label: 'My run', icon: 'route', exact: true },
  { href: '/parcels/courier/pickups', label: 'Pickups', icon: 'pickups' },
  { href: '/parcels/courier/wallet', label: 'Wallet', icon: 'wallet' },
];

/** Sends the phone's place while the app is open and says so when location is blocked. */
function Location() {
  const t = useT();
  const state = useLocationPing();
  useEffect(() => registerOfflineShell(), []);
  if (state !== 'denied') return null;
  return <p className="mb-3 rounded-md bg-status-needs-action/10 px-3 py-2 text-caption font-semibold text-status-needs-action">{t('Location is blocked. Allow it in the browser so the hub can see where you are')}</p>;
}

export default function CourierLayout({ children }: { children: React.ReactNode }) {
  return (
    <PhoneShell roles={ROLES} tabs={TABS}>
      <CheckInGate>
        <Location />
        {children}
      </CheckInGate>
    </PhoneShell>
  );
}
