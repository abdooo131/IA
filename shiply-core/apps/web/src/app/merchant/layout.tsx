'use client';
import { DeskShell, type Me, type NavGroup } from '@/components/Shell';

const ROLES: Me['role'][] = ['MERCHANT'];

const groups = (me: Me): NavGroup[] => [
  {
    label: me.merchant?.name,
    items: [
      { href: '/merchant', label: 'Parcels', icon: 'orders' },
      { href: '/merchant/new', label: 'New parcel', icon: 'create' },
      { href: '/merchant/pickups', label: 'Pickups', icon: 'pickups' },
      { href: '/merchant/statement', label: 'Money', icon: 'wallet' },
    ],
  },
];

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  return (
    <DeskShell roles={ROLES} groups={groups}>
      {children}
    </DeskShell>
  );
}
