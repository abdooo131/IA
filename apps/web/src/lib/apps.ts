import type { Role } from '@shiplynow/shared';
import type { IconName } from '@/components/Icon';

/**
 * The desk is split into apps, Odoo style: a home screen of tiles, and inside each app a short
 * menu bar whose menus open a list of pages. Pages keep their addresses; this file only says
 * which app and menu each one belongs to. Labels are keys under `apps` in the messages.
 */
export interface AppPage {
  href: string;
  label: string;
  /** Matches only this exact path (an area's home page). */
  exact?: boolean;
  /** Admins only (finance users cannot open it). */
  adminOnly?: boolean;
}
export interface AppMenu {
  label: string;
  pages: AppPage[];
}
export interface AppDef {
  id: AppId;
  icon: IconName;
  /** The tile's color: a solid brand shade that keeps white text readable. */
  color: string;
  /** Roles that see the tile. */
  roles: readonly Role[];
  menus: AppMenu[];
}

export const SETTINGS_APPS = [
  'operations',
  'inventory',
  'merchants',
  'customers',
  'accounting',
  'system',
] as const;
export type AppId = (typeof SETTINGS_APPS)[number];

const settings = (app: AppId): AppPage => ({
  href: `/admin/settings/${app}`,
  label: 'settings',
  adminOnly: true,
});

export const APPS: AppDef[] = [
  {
    id: 'operations',
    icon: 'orders',
    color: '#1D4ED8',
    roles: ['admin'],
    menus: [
      { label: 'dashboard', pages: [{ href: '/admin', label: 'overview', exact: true }] },
      { label: 'orders', pages: [{ href: '/admin/orders', label: 'orders' }] },
      { label: 'alerts', pages: [{ href: '/admin/alerts', label: 'alerts' }] },
      {
        label: 'configuration',
        pages: [
          { href: '/admin/stores', label: 'stores' },
          { href: '/admin/zones', label: 'zones' },
          { href: '/admin/addresses', label: 'addresses' },
          settings('operations'),
        ],
      },
    ],
  },
  {
    id: 'inventory',
    icon: 'inventory',
    color: '#0F766E',
    roles: ['admin'],
    menus: [
      { label: 'stock', pages: [{ href: '/admin/stock', label: 'stockLevels' }] },
      { label: 'receiving', pages: [{ href: '/admin/shipments', label: 'shipments' }] },
      { label: 'transfers', pages: [{ href: '/admin/transfers', label: 'transfers' }] },
      {
        label: 'returns',
        pages: [
          { href: '/admin/returns', label: 'returnsToMerchants' },
          { href: '/admin/damage', label: 'damage' },
        ],
      },
      { label: 'counts', pages: [{ href: '/admin/counts', label: 'counts' }] },
      { label: 'configuration', pages: [settings('inventory')] },
    ],
  },
  {
    id: 'merchants',
    icon: 'store',
    color: '#B45309',
    roles: ['admin'],
    menus: [
      { label: 'merchants', pages: [{ href: '/admin/merchants', label: 'merchants' }] },
      { label: 'products', pages: [{ href: '/admin/products', label: 'products' }] },
      { label: 'shopify', pages: [{ href: '/admin/shopify', label: 'shopifyStores' }] },
      { label: 'configuration', pages: [settings('merchants')] },
    ],
  },
  {
    id: 'customers',
    icon: 'customers',
    color: '#7C3AED',
    roles: ['admin'],
    menus: [
      { label: 'customers', pages: [{ href: '/admin/customers', label: 'profiles' }] },
      { label: 'places', pages: [{ href: '/admin/customers/places', label: 'places' }] },
      { label: 'marketData', pages: [{ href: '/admin/data', label: 'marketData' }] },
      { label: 'configuration', pages: [settings('customers')] },
    ],
  },
  {
    id: 'accounting',
    icon: 'wallet',
    color: '#15803D',
    roles: ['admin', 'finance'],
    menus: [
      {
        label: 'dashboard',
        pages: [
          { href: '/finance', label: 'overview', exact: true },
          { href: '/finance/approvals', label: 'approvals' },
        ],
      },
      {
        label: 'merchants',
        pages: [
          { href: '/finance/merchants', label: 'wallets' },
          { href: '/finance/payouts', label: 'payouts' },
          { href: '/finance/invoices', label: 'invoices' },
          { href: '/finance/receivables', label: 'receivables' },
        ],
      },
      {
        label: 'vendors',
        pages: [
          { href: '/finance/bills', label: 'bills' },
          { href: '/finance/movements', label: 'movements' },
          { href: '/finance/recurring', label: 'recurring' },
          { href: '/finance/assets', label: 'assets' },
        ],
      },
      {
        label: 'cashBank',
        pages: [
          { href: '/finance/cash', label: 'storeCash' },
          { href: '/finance/bank', label: 'bankMatching' },
          { href: '/finance/receipts', label: 'receipts' },
        ],
      },
      {
        label: 'employees',
        pages: [
          { href: '/finance/payroll', label: 'payroll', exact: true },
          { href: '/finance/payroll/payslips', label: 'payslips' },
          { href: '/finance/riders', label: 'riders' },
        ],
      },
      {
        label: 'reporting',
        pages: [
          { href: '/finance/profit-and-loss', label: 'profitAndLoss' },
          { href: '/finance/balance-sheet', label: 'balanceSheet' },
          { href: '/finance/statements', label: 'comparePeriods' },
          { href: '/finance/profit', label: 'profitPerStore' },
          { href: '/finance/money-flow', label: 'cashFlow' },
          { href: '/finance/budgets', label: 'budgets' },
          { href: '/finance/taxes', label: 'taxes' },
          { href: '/finance/vat', label: 'vat' },
          { href: '/finance/tax-returns', label: 'taxReturns' },
          { href: '/finance/journal', label: 'journal' },
          { href: '/finance/trial', label: 'trial' },
        ],
      },
      {
        label: 'configuration',
        pages: [
          { href: '/finance/accounts', label: 'accounts' },
          { href: '/finance/company', label: 'company' },
          { href: '/finance/close', label: 'close' },
          { href: '/finance/year-end', label: 'yearEnd' },
          { href: '/finance/opening', label: 'opening', adminOnly: true },
          settings('accounting'),
        ],
      },
    ],
  },
  {
    id: 'system',
    icon: 'settings',
    color: '#475569',
    roles: ['admin'],
    menus: [
      { label: 'users', pages: [{ href: '/admin/users', label: 'users' }] },
      { label: 'audit', pages: [{ href: '/admin/audit', label: 'audit' }] },
      { label: 'tickets', pages: [settings('system')] },
    ],
  },
];

const under = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

/** Whether a page is the one open, or a page below it (an order inside Orders). */
export function pageMatches(page: AppPage, pathname: string) {
  return page.exact ? pathname === page.href : under(pathname, page.href);
}

/** The app and page a path belongs to: the page with the longest matching address wins. */
export function locate(pathname: string): { app: AppDef; page: AppPage | null } | null {
  let best: { app: AppDef; page: AppPage } | null = null;
  for (const app of APPS)
    for (const menu of app.menus)
      for (const page of menu.pages)
        if (pageMatches(page, pathname) && (!best || page.href.length > best.page.href.length))
          best = { app, page };
  if (best) return best;
  // A page not on any menu still shows its area's app.
  if (under(pathname, '/finance'))
    return { app: APPS.find((a) => a.id === 'accounting')!, page: null };
  if (under(pathname, '/admin')) return { app: APPS[0]!, page: null };
  return null;
}

/** The app as a given role sees it: tiles it may open and pages it may use. */
export function appsFor(role: Role): AppDef[] {
  return APPS.filter((app) => app.roles.includes(role)).map((app) => ({
    ...app,
    menus: app.menus
      .map((menu) => ({
        ...menu,
        pages: menu.pages.filter((page) => role === 'admin' || !page.adminOnly),
      }))
      .filter((menu) => menu.pages.length > 0),
  }));
}
