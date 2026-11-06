import { JOB_ROLE_TEMPLATES, type JobRole, NO_ACCESS } from '@shiplynow/shared';
import { describe, expect, it } from 'vitest';
import { appsFor, canOpenPath, canOpenStoreScreens } from './apps';

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
    expect(apps).toEqual([
      'operations',
      'inventory',
      'merchants',
      'customers',
      'accounting',
      'hr',
      'system',
    ]);
    expect(pages('owner')).toContain('/finance/opening');
    expect(pages('owner')).toContain('/admin/settings/operations');
  });

  it('shows a store manager operations, inventory and attendance, without settings pages', () => {
    expect(appsFor(profile('store_manager')).map((a) => a.id)).toEqual([
      'operations',
      'inventory',
      'hr',
    ]);
    expect(pages('store_manager')).toContain('/admin/hr/attendance');
    expect(pages('store_manager')).not.toContain('/admin/settings/hr');
    expect(pages('store_manager')).not.toContain('/admin/settings/operations');
    expect(canOpenStoreScreens(profile('store_manager'))).toBe(true);
  });

  it('gives store staff no apps, only the store screens', () => {
    expect(appsFor(profile('store_staff'))).toEqual([]);
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
      '/admin/hr',
      '/admin/hr/org',
      '/admin/hr/attendance',
      '/admin/hr/attendance/days',
      '/admin/hr/roster',
      '/admin/hr/documents',
      '/admin/hr/checklists',
      '/admin/hr/departments',
      '/admin/hr/positions',
      '/admin/hr/grades',
      '/admin/hr/document-types',
      '/admin/hr/checklist-templates',
      '/admin/hr/shifts',
      '/admin/hr/holidays',
    ]);
    // HR manager adds the salaries switch, still no accounting.
    expect(appsFor(profile('hr_manager')).map((a) => a.id)).toEqual(['hr']);
    expect(pages('owner')).toContain('/admin/settings/hr');
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
});
