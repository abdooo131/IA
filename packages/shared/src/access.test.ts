import { describe, expect, it } from 'vitest';
import {
  ACCESS_APPS,
  accessFromBody,
  APP_LEVELS,
  canDo,
  canUseStore,
  JOB_ROLE_TEMPLATES,
  JOB_ROLES,
  matchJobRole,
  merchantRightsOf,
  NO_ACCESS,
  setAccessSchema,
} from './access';

describe('job role templates', () => {
  it('match the table in docs/ACCESS.md', () => {
    const row = (r: keyof typeof JOB_ROLE_TEMPLATES) => {
      const t = JOB_ROLE_TEMPLATES[r];
      return [
        ...ACCESS_APPS.map((a) => t[a]),
        t.allStores,
        t.customerData,
        t.salaries,
        t.ownMerchantsOnly,
      ];
    };
    const M = 'manage';
    const U = 'use';
    const V = 'view';
    const N = 'none';
    expect(row('owner')).toEqual([M, M, M, M, M, M, M, M, true, true, true, false]);
    expect(row('operations_manager')).toEqual([M, M, M, V, V, N, N, N, true, false, false, false]);
    expect(row('store_manager')).toEqual([M, U, U, N, N, N, V, N, false, false, false, false]);
    expect(row('store_staff')).toEqual([U, N, N, N, N, N, N, N, false, false, false, false]);
    expect(row('hub_staff')).toEqual([U, N, V, N, N, N, N, N, false, false, false, false]);
    expect(row('dispatcher')).toEqual([U, U, V, N, N, N, N, N, true, false, false, false]);
    expect(row('customer_service')).toEqual([N, U, V, V, V, N, N, N, true, true, false, false]);
    expect(row('accountant')).toEqual([N, V, V, V, N, V, N, N, true, false, false, false]);
    expect(row('finance_officer')).toEqual([N, V, V, V, N, U, N, N, true, false, false, false]);
    expect(row('hr_officer')).toEqual([N, N, N, N, N, N, M, N, true, false, false, false]);
    expect(row('account_manager')).toEqual([N, V, V, U, V, N, N, N, true, false, false, true]);
    expect(row('qc_agent')).toEqual([U, N, V, N, N, N, N, N, false, false, false, false]);
    expect(row('finance_manager')).toEqual([N, V, V, V, N, M, N, N, true, false, true, false]);
  });

  it('only use levels each app offers', () => {
    for (const role of JOB_ROLES)
      for (const app of ACCESS_APPS)
        expect(APP_LEVELS[app], `${role} ${app}`).toContain(JOB_ROLE_TEMPLATES[role][app]);
  });

  it('are told apart by matchJobRole', () => {
    for (const role of JOB_ROLES) expect(matchJobRole(JOB_ROLE_TEMPLATES[role], role)).toBe(role);
    // Only the QC agent shares its values (with hub staff) until the QC queue exists.
    const alike = JOB_ROLES.filter((r) => matchJobRole(JOB_ROLE_TEMPLATES[r]) !== r);
    expect(alike).toEqual(['qc_agent']);
    expect(matchJobRole({ ...JOB_ROLE_TEMPLATES.owner, salaries: false })).toBe('custom');
  });
});

describe('canDo', () => {
  it('orders the levels none < view < use < manage', () => {
    const p = { ...NO_ACCESS, operations: 'use' as const };
    expect(canDo(p, 'operations', 'view')).toBe(true);
    expect(canDo(p, 'operations', 'use')).toBe(true);
    expect(canDo(p, 'operations', 'manage')).toBe(false);
    expect(canDo(p, 'accounting', 'view')).toBe(false);
    expect(canDo(p, 'accounting', 'none')).toBe(true);
  });

  it('lets the store use level read store screens and settings manage read settings', () => {
    expect(canDo(JOB_ROLE_TEMPLATES.store_staff, 'store', 'view')).toBe(true);
    expect(canDo(JOB_ROLE_TEMPLATES.owner, 'settings', 'view')).toBe(true);
    expect(canDo(JOB_ROLE_TEMPLATES.operations_manager, 'settings', 'view')).toBe(false);
  });

  it('refuses everything without a profile', () => {
    expect(canDo(null, 'store', 'view')).toBe(false);
  });

  it('checks stores', () => {
    expect(canUseStore({ allStores: true, storeIds: [] }, 's1')).toBe(true);
    expect(canUseStore({ allStores: false, storeIds: ['s1'] }, 's1')).toBe(true);
    expect(canUseStore({ allStores: false, storeIds: ['s1'] }, 's2')).toBe(false);
    expect(canUseStore(null, 's1')).toBe(false);
  });
});

describe('access body', () => {
  it('fills every field from a job role', () => {
    const body = setAccessSchema.parse({ jobRole: 'store_staff', storeIds: ['s1'] });
    expect(accessFromBody(body)).toMatchObject({
      jobRole: 'store_staff',
      store: 'use',
      allStores: false,
    });
  });

  it('takes custom values and refuses levels an app does not offer', () => {
    const custom = {
      jobRole: 'custom',
      store: 'none',
      operations: 'view',
      inventory: 'none',
      merchants: 'none',
      customers: 'none',
      accounting: 'none',
      settings: 'none',
      allStores: true,
      customerData: false,
      salaries: false,
    };
    expect(accessFromBody(setAccessSchema.parse(custom))).toMatchObject({
      jobRole: 'custom',
      operations: 'view',
    });
    expect(setAccessSchema.safeParse({ ...custom, settings: 'view' }).success).toBe(false);
    expect(setAccessSchema.safeParse({ ...custom, store: 'view' }).success).toBe(false);
    expect(setAccessSchema.safeParse({ jobRole: 'boss' }).success).toBe(false);
  });
});

describe('merchant rights', () => {
  it('gives owners every right and members their list', () => {
    expect(merchantRightsOf({ merchantRole: 'owner', merchantRights: [] })).toEqual([
      'orders',
      'stock',
      'money',
      'settings',
    ]);
    expect(
      merchantRightsOf({ merchantRole: 'member', merchantRights: ['money', 'orders'] }),
    ).toEqual(['orders', 'money']);
  });
});
