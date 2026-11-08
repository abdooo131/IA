import { FINANCE_LISTS, parseListState } from '@shiplynow/shared';
import { describe, expect, it } from 'vitest';
import { appsFor, locate } from './apps';
import { JOB_ROLE_TEMPLATES, type JobRole } from '@shiplynow/shared';
import en from '../../messages/en.json';
import { docNeighbours, exportTable, readDocNav, rowHrefOf, withListState } from './list-view';

const profile = (role: JobRole) => ({
  ...JOB_ROLE_TEMPLATES[role],
  jobRole: role,
  storeIds: [],
  merchantIds: [],
});

describe('list view helpers', () => {
  it('puts the list state in the address and keeps other params', () => {
    const next = withListState('tab=vat&q=old&page=3', 'q=new&f=draft');
    const p = new URLSearchParams(next);
    expect(p.get('tab')).toBe('vat');
    expect(p.get('q')).toBe('new');
    expect(p.get('page')).toBeNull();
    expect(parseListState(p).filters).toEqual(['draft']);
  });

  it('exports money as EGP numbers, statuses in words and dates as days', () => {
    const table = exportTable(
      { valueLabels: { status: { paid: 'Paid' } } },
      [
        { key: 'number', label: 'No', kind: 'ltr' },
        { key: 'amount', label: 'EGP', kind: 'money' },
        { key: 'status', label: 'Status', kind: 'status' },
        { key: 'day', label: 'Day', kind: 'date' },
        { key: 'ok', label: 'Ok', kind: 'bool' },
      ],
      [
        {
          id: '1',
          number: 'PAY-000001',
          amount: 123456,
          status: 'paid',
          day: '2026-11-01T10:00:00Z',
          ok: true,
        },
      ],
      { yes: 'Yes', no: 'No' },
    );
    expect(table.header).toEqual(['No', 'EGP', 'Status', 'Day', 'Ok']);
    expect(table.rows[0]).toEqual(['PAY-000001', 1234.56, 'Paid', '2026-11-01', 'Yes']);
  });

  it('finds the previous and next record of the list the person came from', () => {
    const nav = readDocNav(
      JSON.stringify({
        listUrl: '/finance/payouts?f=draft',
        ids: ['a', 'b', 'c'],
        hrefTemplate: '/finance/payouts/{id}',
      }),
    );
    expect(docNeighbours(nav, 'b')).toEqual({
      index: 2,
      count: 3,
      prev: '/finance/payouts/a',
      next: '/finance/payouts/c',
      listUrl: '/finance/payouts?f=draft',
    });
    expect(docNeighbours(nav, 'a')?.prev).toBeNull();
    expect(docNeighbours(nav, 'zz')).toBeNull();
    expect(readDocNav('not json')).toBeNull();
    expect(rowHrefOf('/finance/bills/{id}', { id: 'x 1' })).toBe('/finance/bills/x%201');
  });

  it('has words for every filter and grouping of every Accounting list', () => {
    const lists = en.lists as unknown as Record<string, Record<string, Record<string, string>>>;
    for (const [id, meta] of Object.entries(FINANCE_LISTS)) {
      for (const f of Object.keys(meta.filters))
        expect(lists[id]?.filters?.[f] ?? lists.filters?.[f], `${id}.${f}`).toBeTruthy();
      for (const g of meta.groupBys)
        expect(lists[id]?.groups?.[g] ?? lists.groups?.[g], `${id}.${g}`).toBeTruthy();
      expect(lists[id]?.exportName).toBeTruthy();
    }
  });
});

describe('Accounting menus by job', () => {
  it('groups pages by what people do and keeps every address', () => {
    const accounting = appsFor(profile('owner')).find((a) => a.id === 'accounting')!;
    expect(accounting.menus.map((m) => m.label)).toEqual([
      'dashboard',
      'moneyIn',
      'moneyOut',
      'cashBank',
      'reporting',
      'monthEnd',
      'setup',
    ]);
    const pages = accounting.menus.flatMap((m) => m.pages.map((p) => p.href));
    for (const href of [
      '/finance',
      '/finance/approvals',
      '/finance/payouts',
      '/finance/cheques',
      '/finance/bills',
      '/finance/rider-withdrawals',
      '/finance/petty-cash',
      '/finance/bank',
      '/finance/reports',
      '/finance/journal',
      '/finance/trial',
      '/finance/month-end',
      '/finance/taxes',
      '/finance/accounts',
      '/finance/contracts',
    ])
      expect(pages).toContain(href);
    expect(locate('/finance/payouts/abc')?.page?.href).toBe('/finance/payouts');
    expect(locate('/finance/journal/abc')?.page?.label).toBe('journal');
    const officer = appsFor(profile('finance_officer')).find((a) => a.id === 'accounting')!;
    expect(officer.menus.flatMap((m) => m.pages.map((p) => p.href))).not.toContain(
      '/finance/payroll',
    );
  });
});
