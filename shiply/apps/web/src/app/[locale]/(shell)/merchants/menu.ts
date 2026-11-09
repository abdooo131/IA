import type { MenuItem } from '@/shell/AppShell';

/** Merchants menu (UI.md Step 3b). */
export const MERCHANTS_MENU: MenuItem[] = [
  { label: 'merchants.merchants', href: '/merchants/list' },
  { label: 'merchants.signups', href: '/merchants/signups' },
  { label: 'merchants.contracts', href: '/merchants/contracts' },
  { label: 'merchants.shopify', href: '/merchants/shopify' },
  { label: 'merchants.packaging', href: '/merchants/packaging' },
];
