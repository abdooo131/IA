'use client';
import { DeskShell, type Me, type NavGroup, type NavItem } from '@/parcels/components/Shell';

const ROLES: Me['role'][] = ['MERCHANT'];

/** The menu shows only what this person's rights open, as in Shiply Now; the owner sees everything. */
const groups = (me: Me): NavGroup[] => {
  const can = (right: string) => me.merchantOwner || me.merchantRights.includes(right);
  const items: (NavItem & { show: boolean })[] = [
    { href: '/parcels/merchant', label: 'Parcels', icon: 'orders', show: can('orders') },
    { href: '/parcels/merchant/new', label: 'New parcel', icon: 'create', show: can('orders') },
    { href: '/parcels/merchant/pickups', label: 'Pickups', icon: 'pickups', show: can('pickups') },
    { href: '/parcels/merchant/statement', label: 'Money', icon: 'wallet', show: can('money') },
    { href: '/parcels/merchant/invoices', label: 'Tax invoices', icon: 'invoice', show: can('money') },
    { href: '/parcels/merchant/shop', label: 'Packaging shop', icon: 'packaging', show: can('orders') },
    { href: '/parcels/merchant/analytics', label: 'Analytics', icon: 'analytics', show: true },
    { href: '/parcels/merchant/prices', label: 'My prices', icon: 'points', show: true },
    { href: '/parcels/merchant/team', label: 'Team', icon: 'customers', show: me.merchantOwner },
    { href: '/parcels/merchant/shopify', label: 'Shopify', icon: 'store', show: can('orders') },
    { href: '/parcels/merchant/developer', label: 'Developers', icon: 'international', show: can('settings') },
    { href: '/parcels/merchant/settings', label: 'Settings', icon: 'settings', show: can('settings') || can('pickups') },
  ];
  return [{ label: me.merchant?.name, items: items.filter((i) => i.show).map(({ show: _s, ...i }) => i) }];
};

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  return (
    <DeskShell roles={ROLES} groups={groups}>
      {children}
    </DeskShell>
  );
}
