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
  /** The access app behind it: the tile shows from view (settings: manage). */
  access: AccessApp;
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
export type AppId = (typeof SETTINGS_APPS)[number];

/** Changing settings needs settings manage, so their pages are shown only then. */
const settings = (app: AppId): AppPage => ({
  href: `/admin/settings/${app}`,
  label: 'settings',
  need: { app: 'settings', level: 'manage' },
});

export const APPS: AppDef[] = [
  {
    id: 'operations',
    icon: 'orders',
    color: '#1D4ED8',
    access: 'operations',
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
    access: 'inventory',
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
      { label: 'packaging', pages: [{ href: '/admin/packaging', label: 'packaging' }] },
      { label: 'configuration', pages: [settings('inventory')] },
    ],
  },
  {
    id: 'merchants',
    icon: 'store',
    color: '#B45309',
    access: 'merchants',
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
    access: 'customers',
    menus: [
      {
        label: 'customers',
        pages: [{ href: '/admin/customers', label: 'profiles', need: { customerData: true } }],
      },
      { label: 'places', pages: [{ href: '/admin/customers/places', label: 'places' }] },
      { label: 'marketData', pages: [{ href: '/admin/data', label: 'marketData' }] },
      { label: 'configuration', pages: [settings('customers')] },
    ],
  },
  {
    id: 'accounting',
    icon: 'wallet',
    color: '#15803D',
    access: 'accounting',
    // Accounting UX phase A: menus by job (what comes in, what goes out, cash and bank,
    // reports, month end, setup); every page keeps its address. Phase B adds the guided runs
    // (Pay merchants, Close the month) and the Record an expense form.
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
          { href: '/finance/payouts/run', label: 'payMerchants' },
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
          { href: '/finance/expenses/new', label: 'recordExpense', need: { level: 'use' } },
          { href: '/finance/bills', label: 'bills' },
          { href: '/finance/purchase-orders', label: 'purchaseOrders' },
          { href: '/finance/movements', label: 'movements' },
          { href: '/finance/petty-cash', label: 'pettyCash' },
          { href: '/finance/rider-withdrawals', label: 'riderWithdrawals' },
          { href: '/finance/expense-claims', label: 'expenseClaims' },
          { href: '/finance/riders', label: 'riders' },
          { href: '/finance/rider-offices', label: 'riderOffices' },
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
          { href: '/finance/bank', label: 'bankMatching' },
          { href: '/finance/receipts', label: 'receipts' },
          { href: '/finance/loans', label: 'loans' },
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
          { href: '/finance/reports/tags', label: 'costTagReport' },
          { href: '/finance/budgets', label: 'budgets' },
          { href: '/finance/statements', label: 'comparePeriods' },
          { href: '/finance/trial', label: 'trial' },
          { href: '/finance/journal', label: 'journal' },
        ],
      },
      {
        label: 'monthEnd',
        pages: [
          { href: '/finance/month-end/run', label: 'closeMonthRun' },
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
          { href: '/finance/cost-tags', label: 'costTags' },
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
    menus: [
      // HR phase 1: the HR home first, then people, time, discipline, the inbox and one
      // Configuration menu (docs/HR.md "Phase 1 as built").
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
    // Sales CRM (docs/SALES.md): view reads, use works deals, manage assigns and configures.
    id: 'sales',
    icon: 'analytics',
    color: '#B91C1C',
    access: 'sales',
    menus: [
      {
        label: 'pipeline',
        pages: [
          { href: '/admin/sales/pipeline', label: 'pipelineBoard' },
          { href: '/admin/sales/deals', label: 'pipelineList' },
        ],
      },
      { label: 'leads', pages: [{ href: '/admin/sales/leads', label: 'leads' }] },
      { label: 'myDay', pages: [{ href: '/admin/sales/my-day', label: 'myDay' }] },
      { label: 'companies', pages: [{ href: '/admin/sales/companies', label: 'companies' }] },
      // Part 2: proposals, the dashboard, targets (set by managers) and commission.
      { label: 'proposals', pages: [{ href: '/admin/sales/proposals', label: 'proposals' }] },
      {
        label: 'salesDashboard',
        pages: [{ href: '/admin/sales/dashboard', label: 'salesDashboard' }],
      },
      {
        label: 'targets',
        pages: [{ href: '/admin/sales/targets', label: 'targets', need: { level: 'manage' } }],
      },
      { label: 'commission', pages: [{ href: '/admin/sales/commission', label: 'commission' }] },
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
    id: 'system',
    icon: 'settings',
    color: '#475569',
    access: 'settings',
    menus: [
      {
        label: 'users',
        pages: [{ href: '/admin/users', label: 'users', need: { level: 'manage' } }],
      },
      {
        label: 'audit',
        pages: [{ href: '/admin/audit', label: 'audit', need: { level: 'manage' } }],
      },
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
  if (under(pathname, '/admin/sales'))
    return { app: APPS.find((a) => a.id === 'sales')!, page: null };
  if (under(pathname, '/admin')) return { app: APPS[0]!, page: null };
  return null;
}

/** The store screens: a tile on the home screen for people with store use (not an app bar). */
export const STORE_TILE = { icon: 'scan', color: '#0E7490', href: '/store' } as const satisfies {
  icon: IconName;
  color: string;
  href: string;
};

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
  return APPS.filter((app) =>
    canDo(profile, app.access, app.access === 'settings' ? 'manage' : 'view'),
  )
    .map((app) => ({
      ...app,
      menus: app.menus
        .map((menu) => ({
          ...menu,
          pages: menu.pages.filter((page) => canOpenPage(profile, app, page)),
        }))
        .filter((menu) => menu.pages.length > 0),
    }))
    .filter((app) => app.menus.length > 0);
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
