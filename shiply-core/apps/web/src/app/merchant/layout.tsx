'use client';
import { Shell, type Me } from '@/components/Shell';

const NAV = [
  { href: '/merchant', label: 'Parcels' },
  { href: '/merchant/new', label: 'New parcel' },
  { href: '/merchant/pickups', label: 'Pickups' },
  { href: '/merchant/statement', label: 'Money' },
];
// Module constant: Shell reloads the user whenever this array changes identity.
const ROLES: Me['role'][] = ['MERCHANT'];

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  return (
    <Shell roles={ROLES} nav={NAV} area="Merchant">
      {children}
    </Shell>
  );
}
