import type { MerchantRightName } from '@shiplynow/shared';
import { getTranslations } from 'next-intl/server';
import type { NavGroup, NavItem } from '@/components/SideNav';
import { apiGet, getMerchantRights } from '@/lib/api-server';

/** The right each menu item needs (docs/ACCESS.md); owners have every right. */
type Item = NavItem & { right?: MerchantRightName | 'owner' };

/**
 * One merchant portal for both services (docs/MERGE.md step 6): the same menu in /merchant
 * (60 minute delivery) and /parcels/merchant (next day parcels), grouped by service, with money
 * and the account shared. Team rights are Shiply Now's: next day parcels and pickups need orders.
 */
export async function merchantNav(): Promise<NavGroup[]> {
  const [me, access, t] = await Promise.all([
    apiGet<{ merchant: { name: string }; unreadNotifications: number }>('/merchant/me'),
    getMerchantRights(),
    getTranslations('merchant.nav'),
  ]);
  const allowed = (right: Item['right']) =>
    !right || (right === 'owner' ? !!access?.owner : !!access?.rights.includes(right));
  const group = (label: string, items: Item[], alwaysOpen = false): NavGroup => ({
    label,
    alwaysOpen,
    items: items.filter((i) => allowed(i.right)).map(({ right: _right, ...item }) => item),
  });
  return [
    group(
      me.merchant.name,
      [
        { href: '/merchant', label: t('home'), icon: 'home', exact: true },
        {
          href: '/merchant/notifications',
          label: t('notifications'),
          icon: 'notifications',
          badge: me.unreadNotifications,
        },
      ],
      true,
    ),
    group(t('groupExpress'), [
      { href: '/merchant/orders', label: t('orders'), icon: 'orders', right: 'orders' },
      { href: '/merchant/new', label: t('new'), icon: 'create', right: 'stock' },
      { href: '/merchant/products', label: t('products'), icon: 'products', right: 'stock' },
      { href: '/merchant/returns', label: t('returns'), icon: 'returns', right: 'stock' },
      { href: '/merchant/delivery', label: t('delivery'), icon: 'courier', right: 'settings' },
    ]),
    group(t('groupParcels'), [
      {
        href: '/parcels/merchant',
        label: t('parcels'),
        icon: 'tracking',
        exact: true,
        right: 'orders',
      },
      { href: '/parcels/merchant/new', label: t('newParcel'), icon: 'create', right: 'orders' },
      { href: '/parcels/merchant/pickups', label: t('pickups'), icon: 'pickups', right: 'orders' },
      { href: '/parcels/merchant/analytics', label: t('parcelAnalytics'), icon: 'analytics' },
      {
        href: '/parcels/merchant/shop',
        label: t('packagingShop'),
        icon: 'products',
        right: 'orders',
      },
      {
        href: '/parcels/merchant/settings',
        label: t('parcelSettings'),
        icon: 'settings',
        right: 'settings',
      },
    ]),
    group(t('groupMoney'), [
      { href: '/merchant/wallet', label: t('wallet'), icon: 'wallet', right: 'money' },
      { href: '/merchant/invoices', label: t('invoices'), icon: 'invoice', right: 'money' },
      { href: '/merchant/contract', label: t('contract'), icon: 'points', right: 'money' },
    ]),
    group(t('groupAccount'), [
      { href: '/merchant/shopify', label: t('shopify'), icon: 'store', right: 'settings' },
      {
        href: '/parcels/merchant/shopify',
        label: t('shopifyParcels'),
        icon: 'store',
        right: 'orders',
      },
      {
        href: '/parcels/merchant/developer',
        label: t('developers'),
        icon: 'international',
        right: 'settings',
      },
      { href: '/merchant/team', label: t('team'), icon: 'customers', right: 'owner' },
    ]),
  ].filter((g) => g.items.length > 0);
}
