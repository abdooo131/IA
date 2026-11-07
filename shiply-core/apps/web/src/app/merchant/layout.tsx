'use client';
import { Shell, type Me , type NavItem } from '@/components/Shell';

const NAV: NavItem[] = [
  { href: '/merchant', label: 'Parcels', icon: 'orders' },
  { href: '/merchant/new', label: 'New parcel', icon: 'create' },
  { href: '/merchant/pickups', label: 'Pickups', icon: 'pickups' },
  { href: '/merchant/statement', label: 'Money', icon: 'wallet' },
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
