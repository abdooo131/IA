import { APP_LISTS, FINANCE_LISTS, parseListState } from '@shiplynow/shared';
import { describe, expect, it } from 'vitest';
import { appsFor, locate } from './apps';
import { JOB_ROLE_TEMPLATES, type JobRole } from '@shiplynow/shared';
import ar from '../../messages/ar.json';
import en from '../../messages/en.json';
import { docNeighbours, exportTable, readDocNav, rowHrefOf, withListState } from './list-view';
import { legacyListAddress } from './legacy-list';

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
      'planning',
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

describe('App lists (UX phase C)', () => {
  it('has words in both languages for every filter, value and grouping', () => {
    for (const messages of [en, ar]) {
      const words = messages.appLists as unknown as Record<
        string,
        Record<string, Record<string, string> | string>
      >;
      // Each list's statuses are named in the words of its own screens.
      const statusesOf: Record<string, Record<string, string>> = {
        orders: messages.orders.statuses,
        shipments: messages.merchant.shipments.statuses,
        transfers: messages.transfers.statuses,
        returns: messages.returns.statuses,
        counts: messages.admin.counts.statuses,
      };
      const causes = messages.damage.causes as Record<string, string>;
      const segments = messages.customers.segments as Record<string, string>;
      const risks = messages.customers.riskLevels as Record<string, string>;
      for (const lists of Object.values(APP_LISTS))
        for (const [id, meta] of Object.entries(lists)) {
          const own = words[id] as Record<string, Record<string, string>> | undefined;
          for (const [f, group] of Object.entries(meta.filters)) {
            const label =
              own?.filters?.[f] ??
              (words.filters as Record<string, string>)[f] ??
              (group === 'status'
                ? statusesOf[id]?.[f]
                : group === 'cause'
                  ? causes[f]
                  : group === 'segment'
                    ? segments[f]
                    : group === 'risk'
                      ? risks[f.replace(/^risk_/, '')]
                      : undefined);
            expect(label, `${id}.${f}`).toBeTruthy();
          }
          // A list's own words first, as appListConfig labels them.
          for (const v of Object.keys(meta.values ?? {}))
            expect(
              own?.values?.[v] ?? (words.values as Record<string, string>)[v],
              `${id}.${v}`,
            ).toBeTruthy();
          for (const g of meta.groupBys)
            expect(
              own?.groups?.[g] ?? (words.groups as Record<string, string>)[g],
              `${id}.${g}`,
            ).toBeTruthy();
          expect(own?.exportName).toBeTruthy();
        }
    }
  });

  it('turns the old list addresses into the list state', () => {
    expect(
      legacyListAddress(
        '/admin/shipments',
        { status: 'received', merchant: 'm1' },
        {
          status: { filter: true },
          merchant: { value: 'merchant' },
        },
      ),
    ).toBe('/admin/shipments?f=received&v=merchant%3Am1');
    expect(
      legacyListAddress('/admin/stock', { f: '', store: 's1' }, { store: { value: 'store' } }),
    ).toBeNull();
    expect(legacyListAddress('/admin/stock', {}, { store: { value: 'store' } })).toBeNull();
  });

  it('opens no page for a row missing what the page needs and keeps value filters', () => {
    expect(rowHrefOf('/admin/orders/{orderId}', { id: 'a', orderId: null } as never)).toBeNull();
    expect(rowHrefOf('/admin/orders/{orderId}', { id: 'a', orderId: 'o1' } as never)).toBe(
      '/admin/orders/o1',
    );
    expect(withListState('v=store:x&tab=1', 'f=&q=a')).toBe('f=&q=a&tab=1');
    expect(parseListState(new URLSearchParams('f=active&v=store:abc')).values).toEqual({
      store: 'abc',
    });
  });

  it('exports a formatted column through its formatter', () => {
    const table = exportTable(
      { valueLabels: {} },
      [{ key: 'message', label: 'Alert', kind: 'text', format: 'alert' }],
      [{ id: '1', type: 'late' }],
      { yes: 'Yes', no: 'No' },
      (_c, row) => `Late: ${String(row.type)}`,
    );
    expect(table.rows).toEqual([['Late: late']]);
  });
});
