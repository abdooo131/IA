import { type AccessApp, type AccessLevel, type AccessProfile, canDo } from '@shiplynow/shared';
import type { IconName } from '@/components/Icon';

/**
 * The desk is split into apps, Odoo style: a home screen of tiles, and inside each app a short
 * menu bar whose menus open a list of pages. Pages keep their addresses; this file says which
 * app and menu each one belongs to and what access it needs (the same rule the API applies to
 * the page's data, docs/ACCESS.md). Labels are keys under `apps` in the messages.
 */
export interface PageNeed {
  /** The app whose level is needed (default: the page's app) */
  app?: AccessApp;
  /** The level needed (default view) */
  level?: AccessLevel;
  /** Named customer profiles */
  customerData?: boolean;
  /** Salaries, payslips and the payroll run */
  salaries?: boolean;
  /** Owner only: accounting manage and settings manage */
  owner?: boolean;
}
export interface AppPage {
  href: string;
  label: string;
  /** Matches only this exact path (an area's home page). */
  exact?: boolean;
  /** What the person needs beyond view on the page's app. */
  need?: PageNeed;
}
export interface AppMenu {
  label: string;
  pages: AppPage[];
}
export interface AppDef {
  id: AppId;
  icon: IconName;
  /** The tile's color, from the brand v2 palette; AppTileIcon picks white or Navy for the icon. */
  color: string;
  /** The access app behind it: pages need view on it unless they name another app. */
  access: AccessApp;
  /** Where the tile sits on the home screen: an operation of one company or a shared department. */
  group: 'operations' | 'shared';
  menus: AppMenu[];
}

export const SETTINGS_APPS = [
  'operations',
  'inventory',
  'merchants',
  'customers',
  'accounting',
  'hr',
  'sales',
  'system',
] as const;
/** The settings pages (/admin/settings/<key>); each sits in its app's Configuration menu. */
export type SettingsAppId = (typeof SETTINGS_APPS)[number];
/**
 * The home screen (docs/MERGE.md "One structure"): two operations, Shiply Now and Shiply, each
 * with the same menus (Dashboard, the work, Team, Control, Configuration), then the departments
 * both companies share. A tile shows when the person may open at least one of its pages.
 */
export type AppId =
  'operations' | 'shiply' | 'merchants' | 'sales' | 'accounting' | 'hr' | 'system';

/** Changing settings needs settings manage, so their pages are shown only then. */
const settings = (app: SettingsAppId): AppPage => ({
  href: `/admin/settings/${app}`,
  label: 'settings',
  need: { app: 'settings', level: 'manage' },
});
const named = (app: SettingsAppId, label: string): AppPage => ({ ...settings(app), label });

export const APPS: AppDef[] = [
  {
    // Shiply Now: 60 minute delivery from dark stores. Its stock pages need the Inventory level.
    id: 'operations',
    icon: 'orders',
    color: '#1D4ED8',
    access: 'operations',
    group: 'operations',
    menus: [
      { label: 'dashboard', pages: [{ href: '/admin', label: 'overview', exact: true }] },
      { label: 'orders', pages: [{ href: '/admin/orders', label: 'orders' }] },
      {
        label: 'stock',
        pages: [
          { href: '/admin/stock', label: 'stockLevels', need: { app: 'inventory' } },
          { href: '/admin/shipments', label: 'shipments', need: { app: 'inventory' } },
          { href: '/admin/transfers', label: 'transfers', need: { app: 'inventory' } },
          { href: '/admin/counts', label: 'counts', need: { app: 'inventory' } },
          { href: '/admin/packaging', label: 'packaging', need: { app: 'inventory' } },
        ],
      },
      {
        label: 'returns',
        pages: [
          { href: '/admin/returns', label: 'returnsToMerchants', need: { app: 'inventory' } },
          { href: '/admin/damage', label: 'damage', need: { app: 'inventory' } },
        ],
      },
      { label: 'control', pages: [{ href: '/admin/alerts', label: 'alerts' }] },
      {
        // The dark store floor: receive, put away, pick, pack, hand to riders, cash.
        label: 'floor',
        pages: [{ href: '/store', label: 'storeFloor', need: { app: 'store', level: 'use' } }],
      },
      {
        label: 'configuration',
        pages: [
          { href: '/admin/stores', label: 'stores' },
          { href: '/admin/zones', label: 'zones' },
          { href: '/admin/addresses', label: 'addresses' },
          named('operations', 'deliverySettings'),
          named('inventory', 'stockSettings'),
        ],
      },
    ],
  },
  {
    // Shiply: next day parcels through the sorting facilities, its own team and floor.
    id: 'shiply',
    icon: 'courier',
    color: '#0F766E',
    access: 'shiply',
    group: 'operations',
    menus: [
      { label: 'dashboard', pages: [{ href: '/parcels/admin', label: 'overview', exact: true }] },
      { label: 'parcels', pages: [{ href: '/parcels/admin/shipments', label: 'parcels' }] },
      {
        // The hub floor: inbound, sorting and outbound stations, pickups, courier runs, the
        // handover check, damage and the hub safe (each team member sees only their station).
        label: 'floor',
        pages: [{ href: '/parcels/hub', label: 'hubFloor', need: { level: 'use' } }],
      },
      {
        label: 'team',
        pages: [
          { href: '/parcels/admin/live', label: 'couriersLive' },
          { href: '/parcels/admin/agents', label: 'agents' },
          { href: '/parcels/admin/attendance', label: 'courierShifts' },
          { href: '/parcels/admin/vehicle-requests', label: 'vehicleRequests' },
          // Couriers, hub staff and agents' logins: the field team is run here, not in Settings.
          { href: '/parcels/admin/users', label: 'fieldAccounts', need: { level: 'use' } },
        ],
      },
      {
        label: 'control',
        pages: [
          { href: '/parcels/admin/alerts', label: 'alerts' },
          { href: '/parcels/admin/attempts', label: 'failedAttempts' },
          { href: '/parcels/admin/qc', label: 'qualityTickets' },
          { href: '/parcels/admin/lost', label: 'lostParcels' },
          { href: '/parcels/admin/claims', label: 'merchantClaims' },
        ],
      },
      {
        label: 'configuration',
        pages: [
          { href: '/parcels/admin/network', label: 'network' },
          { href: '/parcels/admin/price-tiers', label: 'priceTiers' },
          { href: '/parcels/admin/messages', label: 'messages' },
          { href: '/parcels/admin/settings', label: 'shiplySettings' },
        ],
      },
    ],
  },
  {
    // One merchant list for both services; the packaging shop and next day sign ups need Shiply.
    id: 'merchants',
    icon: 'store',
    color: '#B45309',
    access: 'merchants',
    group: 'shared',
    menus: [
      {
        label: 'merchants',
        pages: [
          { href: '/admin/merchants', label: 'merchants' },
          { href: '/parcels/admin/signups', label: 'nextDaySignups', need: { app: 'shiply' } },
        ],
      },
      { label: 'products', pages: [{ href: '/admin/products', label: 'products' }] },
      {
        label: 'packagingShop',
        pages: [
          { href: '/parcels/admin/shop/orders', label: 'packagingOrders', need: { app: 'shiply' } },
          {
            href: '/parcels/admin/shop/products',
            label: 'packagingProducts',
            need: { app: 'shiply' },
          },
          {
            href: '/parcels/admin/shop/purchase-orders',
            label: 'purchaseOrders',
            need: { app: 'shiply' },
          },
        ],
      },
      {
        label: 'customers',
        pages: [
          {
            href: '/admin/customers',
            label: 'profiles',
            need: { app: 'customers', customerData: true },
          },
          { href: '/admin/customers/places', label: 'places', need: { app: 'customers' } },
          { href: '/admin/data', label: 'marketData', need: { app: 'customers' } },
        ],
      },
      { label: 'shopify', pages: [{ href: '/admin/shopify', label: 'shopifyStores' }] },
      {
        label: 'configuration',
        pages: [named('merchants', 'merchantSettings'), named('customers', 'customerSettings')],
      },
    ],
  },
  {
    // Sales CRM (docs/SALES.md): view reads, use works deals, manage assigns and configures.
    id: 'sales',
    icon: 'analytics',
    color: '#7C3AED',
    access: 'sales',
    group: 'shared',
    menus: [
      {
        label: 'pipeline',
        pages: [
          { href: '/admin/sales/pipeline', label: 'pipelineBoard' },
          { href: '/admin/sales/deals', label: 'pipelineList' },
          { href: '/admin/sales/my-day', label: 'myDay' },
        ],
      },
      {
        label: 'leads',
        pages: [
          { href: '/admin/sales/leads', label: 'leads' },
          { href: '/admin/sales/companies', label: 'companies' },
        ],
      },
      { label: 'proposals', pages: [{ href: '/admin/sales/proposals', label: 'proposals' }] },
      {
        label: 'results',
        pages: [
          { href: '/admin/sales/dashboard', label: 'salesDashboard' },
          { href: '/admin/sales/targets', label: 'targets', need: { level: 'manage' } },
          { href: '/admin/sales/commission', label: 'commission' },
        ],
      },
      {
        label: 'configuration',
        pages: [
          { href: '/admin/sales/lost-reasons', label: 'lostReasons', need: { level: 'manage' } },
          settings('sales'),
        ],
      },
    ],
  },
  {
    id: 'accounting',
    icon: 'wallet',
    color: '#15803D',
    access: 'accounting',
    group: 'shared',
    // Menus by job (what comes in, what goes out, cash and bank, reports, month end, setup) for
    // both companies; Shiply's courier wallets, hub safes and agents sit beside their twins.
    menus: [
      {
        label: 'dashboard',
        pages: [
          { href: '/finance', label: 'accountingDashboard', exact: true },
          { href: '/finance/approvals', label: 'approvals' },
        ],
      },
      {
        label: 'moneyIn',
        pages: [
          { href: '/finance/merchants', label: 'wallets' },
          { href: '/finance/payouts', label: 'payouts' },
          { href: '/finance/invoices', label: 'invoices' },
          { href: '/finance/receivables', label: 'receivables' },
          { href: '/finance/cheques', label: 'cheques' },
          { href: '/finance/emails', label: 'emails' },
        ],
      },
      {
        label: 'moneyOut',
        pages: [
          { href: '/finance/bills', label: 'bills' },
          { href: '/finance/purchase-orders', label: 'purchaseOrders' },
          { href: '/parcels/admin/money/agents', label: 'agentSettlements' },
          { href: '/parcels/admin/money/advances', label: 'agentAdvances' },
          { href: '/finance/movements', label: 'movements' },
          { href: '/finance/petty-cash', label: 'pettyCash' },
          { href: '/finance/rider-withdrawals', label: 'riderWithdrawals' },
          { href: '/finance/riders', label: 'riders' },
          { href: '/parcels/admin/money/couriers', label: 'courierWallets' },
          { href: '/finance/payroll', label: 'payroll', exact: true, need: { salaries: true } },
          { href: '/finance/payroll/payslips', label: 'payslips', need: { salaries: true } },
          { href: '/finance/recurring', label: 'recurring' },
          { href: '/finance/assets', label: 'assets' },
        ],
      },
      {
        label: 'cashBank',
        pages: [
          { href: '/finance/cash-position', label: 'cashPosition' },
          { href: '/finance/cash', label: 'storeCash' },
          { href: '/parcels/admin/money/safes', label: 'hubSafes' },
          { href: '/finance/bank', label: 'bankMatching' },
          { href: '/finance/receipts', label: 'receipts' },
        ],
      },
      {
        label: 'reporting',
        pages: [
          { href: '/finance/reports', label: 'allReports' },
          { href: '/finance/profit-and-loss', label: 'profitAndLoss' },
          { href: '/finance/balance-sheet', label: 'balanceSheet' },
          { href: '/finance/money-flow', label: 'cashFlow' },
          { href: '/finance/profit', label: 'profitPerStore' },
          { href: '/finance/merchant-profit', label: 'merchantProfit' },
          { href: '/finance/budgets', label: 'budgets' },
          { href: '/finance/statements', label: 'comparePeriods' },
          { href: '/finance/trial', label: 'trial' },
          { href: '/finance/journal', label: 'journal' },
        ],
      },
      {
        label: 'monthEnd',
        pages: [
          { href: '/finance/month-end', label: 'monthEndChecklist' },
          { href: '/finance/close', label: 'close' },
          { href: '/finance/year-end', label: 'yearEnd' },
          { href: '/finance/taxes', label: 'taxes' },
        ],
      },
      {
        label: 'setup',
        pages: [
          { href: '/finance/accounts', label: 'accounts' },
          { href: '/finance/company', label: 'company' },
          { href: '/finance/contracts', label: 'contracts' },
          { href: '/finance/opening', label: 'opening', need: { owner: true } },
          settings('accounting'),
        ],
      },
    ],
  },
  {
    id: 'hr',
    icon: 'account',
    color: '#BE185D',
    access: 'hr',
    group: 'shared',
    menus: [
      // HR phase 1: the HR home first, then people, time, discipline, the inbox and one
      // Configuration menu (docs/HR.md "Phase 1 as built"). Everyone of both companies.
      {
        label: 'hrOverview',
        pages: [{ href: '/admin/hr/overview', label: 'hrOverview', exact: true }],
      },
      {
        label: 'employees',
        pages: [
          { href: '/admin/hr', label: 'employeeList' },
          // HR phase 2: the new hire wizard (HR use) and leavers' things without an owner.
          { href: '/admin/hr/hire', label: 'newHire', need: { level: 'use' } },
          { href: '/admin/hr/org', label: 'orgChart' },
          { href: '/admin/hr/documents', label: 'hrDocuments' },
          { href: '/admin/hr/documents/calendar', label: 'expiryCalendar' },
          { href: '/admin/hr/checklists', label: 'hrChecklists' },
          { href: '/admin/hr/needs-owner', label: 'needsOwner' },
        ],
      },
      {
        label: 'time',
        pages: [
          { href: '/admin/hr/attendance', label: 'attendanceToday', exact: true },
          { href: '/admin/hr/attendance/days', label: 'attendanceDays' },
          { href: '/admin/hr/roster', label: 'roster' },
          { href: '/admin/hr/leave', label: 'leaveRequests' },
          { href: '/admin/hr/leave/calendar', label: 'leaveCalendar' },
          { href: '/admin/hr/leave/balances', label: 'leaveBalances' },
        ],
      },
      {
        label: 'discipline',
        pages: [
          { href: '/admin/hr/violations', label: 'violations' },
          { href: '/admin/hr/violations/suggested', label: 'suggestedViolations' },
        ],
      },
      { label: 'hrInbox', pages: [{ href: '/admin/hr/inbox', label: 'hrInbox' }] },
      {
        label: 'configuration',
        pages: [
          { href: '/admin/hr/organisation', label: 'organisation' },
          { href: '/admin/hr/attendance-setup', label: 'attendanceSetup' },
          { href: '/admin/hr/leave/types', label: 'leaveTypes' },
          { href: '/admin/hr/violations/types', label: 'violationTypes' },
          { href: '/admin/hr/document-types', label: 'documentTypes' },
          { href: '/admin/hr/checklist-templates', label: 'checklistTemplates' },
          settings('hr'),
        ],
      },
    ],
  },
  {
    // Settings: users and access (Shiply's field accounts are run in Shiply's Team menu), the
    // audit log and the general settings.
    id: 'system',
    icon: 'settings',
    color: '#475569',
    access: 'settings',
    group: 'shared',
    menus: [
      {
        label: 'users',
        pages: [
          { href: '/admin/users', label: 'users', need: { level: 'manage' } },
        ],
      },
      {
        label: 'audit',
        pages: [{ href: '/admin/audit', label: 'audit', need: { level: 'manage' } }],
      },
      { label: 'general', pages: [named('system', 'generalSettings')] },
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
  if (under(pathname, '/parcels/admin/money'))
    return { app: APPS.find((a) => a.id === 'accounting')!, page: null };
  if (under(pathname, '/parcels/admin'))
    return { app: APPS.find((a) => a.id === 'shiply')!, page: null };
  if (under(pathname, '/admin/sales'))
    return { app: APPS.find((a) => a.id === 'sales')!, page: null };
  if (under(pathname, '/admin')) return { app: APPS[0]!, page: null };
  return null;
}

type Profile = AccessProfile | null | undefined;

/** Owner only actions (opening balances, the e-invoice signer key): accounting and settings manage. */
export function isOwner(profile: Profile) {
  return canDo(profile, 'accounting', 'manage') && canDo(profile, 'settings', 'manage');
}

/** Whether the person may open a page of this app (the API checks the same on its data). */
export function canOpenPage(profile: Profile, app: Pick<AppDef, 'access'>, page: AppPage) {
  if (!profile) return false;
  const need = page.need ?? {};
  const level = need.level ?? (app.access === 'settings' ? 'manage' : 'view');
  if (!canDo(profile, need.app ?? app.access, level)) return false;
  if (need.customerData && !profile.customerData) return false;
  if (need.salaries && !profile.salaries) return false;
  if (
    need.owner &&
    !(canDo(profile, 'accounting', 'manage') && canDo(profile, 'settings', 'manage'))
  )
    return false;
  return true;
}

/** The apps a person may open, each with only the pages they may use. */
export function appsFor(profile: Profile): AppDef[] {
  if (!profile) return [];
  return APPS.map((app) => ({
    ...app,
    menus: app.menus
      .map((menu) => ({
        ...menu,
        pages: menu.pages.filter((page) => canOpenPage(profile, app, page)),
      }))
      .filter((menu) => menu.pages.length > 0),
  })).filter((app) => app.menus.length > 0);
}

/** Whether the store screens tile shows. */
export function canOpenStoreScreens(profile: Profile) {
  return canDo(profile, 'store', 'use');
}

/**
 * Whether a path inside the apps may be opened: false only for a page on a menu the person
 * may not use (the page then shows not found). Pages on no menu are left to the API.
 */
export function canOpenPath(profile: Profile, pathname: string) {
  const here = locate(pathname);
  if (!here?.page) return true;
  return canOpenPage(profile, here.app, here.page);
}
