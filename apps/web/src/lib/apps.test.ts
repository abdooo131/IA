import { JOB_ROLE_TEMPLATES, type JobRole, NO_ACCESS } from '@shiplynow/shared';
import { describe, expect, it } from 'vitest';
import { appsFor, canOpenPath, canOpenStoreScreens, locate } from './apps';

const profile = (role: JobRole) => ({
  ...JOB_ROLE_TEMPLATES[role],
  jobRole: role,
  storeIds: [],
  merchantIds: [],
});
const pages = (role: JobRole) =>
  appsFor(profile(role)).flatMap((a) => a.menus.flatMap((m) => m.pages.map((p) => p.href)));

describe('appsFor', () => {
  it('gives the owner every app and page', () => {
    const apps = appsFor(profile('owner')).map((a) => a.id);
    // Two operations, then the departments both companies share (docs/MERGE.md "One structure").
    expect(apps).toEqual([
      'operations',
      'shiply',
      'merchants',
      'sales',
      'accounting',
      'hr',
      'system',
    ]);
    expect(pages('owner')).toEqual(
      expect.arrayContaining([
        '/admin/stock',
        '/admin/customers',
        '/parcels/admin/signups',
        '/parcels/admin/shop/orders',
        '/parcels/admin/users',
        '/parcels/admin/money/safes',
      ]),
    );
    expect(locate('/parcels/admin/shop/products')?.app.id).toBe('merchants');
    expect(locate('/parcels/admin/money/couriers')?.app.id).toBe('accounting');
    expect(locate('/parcels/admin/users')?.app.id).toBe('shiply');
    // The operations manager runs the field team in Shiply and has no Settings tile.
    expect(appsFor(profile('operations_manager')).map((a) => a.id)).not.toContain('system');
    expect(locate('/admin/customers/abc')?.app.id).toBe('merchants');
    expect(pages('owner')).toContain('/finance/opening');
    expect(pages('owner')).toContain('/parcels/admin');
    expect(pages('owner')).toContain('/parcels/admin/money/couriers');
    expect(pages('owner')).toContain('/admin/settings/operations');
  });

  it('shows a store manager Shiply Now with its stock, and attendance, without settings pages', () => {
    expect(appsFor(profile('store_manager')).map((a) => a.id)).toEqual(['operations', 'hr']);
    // Stock now lives in Shiply Now and still needs the Inventory level.
    expect(pages('store_manager')).toContain('/admin/stock');
    expect(pages('hr_officer')).not.toContain('/admin/stock');
    expect(pages('store_manager')).toContain('/admin/hr/attendance');
    expect(pages('store_manager')).not.toContain('/admin/settings/hr');
    expect(pages('store_manager')).not.toContain('/admin/settings/operations');
    expect(canOpenStoreScreens(profile('store_manager'))).toBe(true);
  });

  it('puts leave, violations and the inbox in the HR app', () => {
    expect(pages('hr_officer')).toEqual(
      expect.arrayContaining([
        '/admin/hr/leave',
        '/admin/hr/leave/calendar',
        '/admin/hr/leave/balances',
        '/admin/hr/leave/types',
        '/admin/hr/violations',
        '/admin/hr/violations/suggested',
        '/admin/hr/violations/types',
        '/admin/hr/inbox',
      ]),
    );
    expect(locate('/admin/hr/leave/abc')?.page?.href).toBe('/admin/hr/leave');
    expect(locate('/admin/hr/violations/suggested')?.page?.label).toBe('suggestedViolations');
    expect(pages('accountant')).not.toContain('/admin/hr/leave');
  });

  it('puts the store screens in Shiply Now and the hub floor in Shiply', () => {
    // Store staff see Shiply Now with its floor only.
    const staff = appsFor(profile('store_staff'));
    expect(staff.map((a) => a.id)).toEqual(['operations']);
    expect(staff[0]!.menus.flatMap((m) => m.pages.map((p) => p.href))).toEqual(['/store']);
    expect(pages('owner')).toEqual(expect.arrayContaining(['/store', '/parcels/hub']));
    expect(pages('store_manager')).toContain('/store');
    expect(pages('accountant')).not.toContain('/store');
    expect(pages('finance_officer')).not.toContain('/parcels/hub');
    expect(canOpenStoreScreens(profile('store_staff'))).toBe(true);
    expect(canOpenStoreScreens(profile('accountant'))).toBe(false);
  });

  it('hides salaries, owner only and named customer pages', () => {
    expect(pages('finance_officer')).not.toContain('/finance/payroll');
    expect(pages('finance_manager')).toContain('/finance/payroll');
    expect(pages('finance_manager')).not.toContain('/finance/opening');
    expect(pages('operations_manager')).toContain('/admin/customers/places');
    expect(pages('operations_manager')).not.toContain('/admin/customers');
    expect(pages('customer_service')).toContain('/admin/customers');
  });

  it('gives the HR officer the HR app only, with no settings page', () => {
    expect(appsFor(profile('hr_officer')).map((a) => a.id)).toEqual(['hr']);
    expect(pages('hr_officer')).toEqual([
      '/admin/hr/overview',
      '/admin/hr',
      '/admin/hr/hire',
      '/admin/hr/org',
      '/admin/hr/documents',
      '/admin/hr/documents/calendar',
      '/admin/hr/checklists',
      '/admin/hr/needs-owner',
      '/admin/hr/attendance',
      '/admin/hr/attendance/days',
      '/admin/hr/roster',
      '/admin/hr/leave',
      '/admin/hr/leave/calendar',
      '/admin/hr/leave/balances',
      '/admin/hr/violations',
      '/admin/hr/violations/suggested',
      '/admin/hr/inbox',
      '/admin/hr/organisation',
      '/admin/hr/attendance-setup',
      '/admin/hr/leave/types',
      '/admin/hr/violations/types',
      '/admin/hr/document-types',
      '/admin/hr/checklist-templates',
    ]);
    // HR phase 2: the new hire wizard needs HR use; HR view sees the lists only.
    expect(pages('store_manager')).not.toContain('/admin/hr/hire');
    expect(pages('store_manager')).toContain('/admin/hr/needs-owner');
    // HR manager adds the salaries switch, still no accounting.
    expect(appsFor(profile('hr_manager')).map((a) => a.id)).toEqual(['hr']);
    expect(pages('owner')).toContain('/admin/settings/hr');
  });

  it('opens the HR app on its home and groups its menus (HR phase 1)', () => {
    const hr = appsFor(profile('hr_officer'))[0]!;
    expect(hr.menus[0]!.pages[0]!.href).toBe('/admin/hr/overview');
    expect(hr.menus.map((m) => m.label)).toEqual([
      'hrOverview',
      'employees',
      'time',
      'discipline',
      'hrInbox',
      'configuration',
    ]);
    expect(locate('/admin/hr/overview')?.page?.label).toBe('hrOverview');
    expect(locate('/admin/hr/abc123')?.page?.label).toBe('employeeList');
    expect(locate('/admin/hr/attendance-setup')?.page?.label).toBe('attendanceSetup');
    expect(locate('/admin/hr/attendance')?.page?.label).toBe('attendanceToday');
    expect(locate('/admin/hr/violations/abc')?.page?.label).toBe('violations');
    expect(locate('/admin/hr/organisation')?.page?.label).toBe('organisation');
    // A store manager (HR view of their stores) gets the home too.
    expect(pages('store_manager')).toContain('/admin/hr/overview');
  });

  it('opens nothing without a profile', () => {
    expect(appsFor(null)).toEqual([]);
    expect(appsFor(NO_ACCESS)).toEqual([]);
  });
});

describe('canOpenPath', () => {
  it('refuses pages on a menu the person may not use, and leaves others to the API', () => {
    expect(canOpenPath(profile('store_manager'), '/finance')).toBe(false);
    expect(canOpenPath(profile('store_manager'), '/admin/orders/abc')).toBe(true);
    expect(canOpenPath(profile('finance_officer'), '/admin/users')).toBe(false);
    expect(canOpenPath(profile('owner'), '/admin/users')).toBe(true);
    expect(canOpenPath(profile('store_manager'), '/admin/unknown')).toBe(true);
  });

  it('opens the Sales app to sales people, its configuration to managers', () => {
    expect(pages('sales_rep')).toEqual(
      expect.arrayContaining([
        '/admin/sales/pipeline',
        '/admin/sales/deals',
        '/admin/sales/leads',
        '/admin/sales/my-day',
        '/admin/sales/companies',
      ]),
    );
    expect(pages('sales_rep')).not.toContain('/admin/sales/lost-reasons');
    expect(pages('sales_manager')).toContain('/admin/sales/lost-reasons');
    expect(pages('accountant')).not.toContain('/admin/sales/leads');
    expect(canOpenPath(profile('hr_officer'), '/admin/sales/pipeline')).toBe(false);
    expect(canOpenPath(profile('sales_rep'), '/admin/sales/deals/abc')).toBe(true);
    // Leads moved from Merchants to Sales.
    expect(pages('account_manager')).not.toContain('/admin/leads');
    expect(locate('/admin/sales/new')?.app.id).toBe('sales');
  });

  it('shows proposals, the dashboard and commission to reps and targets to managers', () => {
    expect(pages('sales_rep')).toEqual(
      expect.arrayContaining([
        '/admin/sales/proposals',
        '/admin/sales/dashboard',
        '/admin/sales/commission',
      ]),
    );
    expect(pages('sales_rep')).not.toContain('/admin/sales/targets');
    expect(pages('sales_manager')).toContain('/admin/sales/targets');
    expect(pages('accountant')).not.toContain('/admin/sales/commission');
  });
});

describe('words', () => {
  it('names every app, menu and page in English and Arabic', async () => {
    const { APPS } = await import('./apps');
    const missing: string[] = [];
    for (const lang of ['en', 'ar'] as const) {
      const words = (await import(`../../messages/${lang}.json`)).default.apps;
      for (const app of APPS) {
        if (!words.names[app.id]) missing.push(`${lang} names.${app.id}`);
        if (!words.descriptions[app.id]) missing.push(`${lang} descriptions.${app.id}`);
        for (const menu of app.menus) {
          if (!words.menus[menu.label]) missing.push(`${lang} menus.${menu.label}`);
          for (const page of menu.pages)
            if (!words.pages[page.label]) missing.push(`${lang} pages.${page.label}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
