import { describe, expect, it } from 'vitest';
import { crc32, exportCsv, exportXlsx, columnLetter, utf8 } from './export-file';
import { parseDocNumber } from './documents';
import {
  EMPTY_LIST_STATE,
  facetsOf,
  hasListState,
  type ListDef,
  parseListState,
  runList,
  serializeListState,
  sortBy,
  toggleFilter,
  toggleGroupBy,
} from './list-view';

interface Row {
  id: string;
  merchant: string;
  status: 'draft' | 'paid' | 'cancelled';
  day: string;
  amount: number;
  by: string;
}

const rows: Row[] = [
  { id: '1', merchant: 'Nabta', status: 'draft', day: '2026-11-01', amount: 1000, by: 'u1' },
  { id: '2', merchant: 'Nabta', status: 'paid', day: '2026-10-20', amount: 2500, by: 'u2' },
  { id: '3', merchant: 'Nile Pantry', status: 'paid', day: '2026-11-05', amount: 400, by: 'u1' },
  {
    id: '4',
    merchant: 'Nile Pantry',
    status: 'cancelled',
    day: '2026-11-06',
    amount: 50,
    by: 'u2',
  },
  { id: '5', merchant: 'Ahmed Store', status: 'draft', day: '2026-11-07', amount: 7, by: 'u2' },
];

const def: ListDef<Row> = {
  id: 'payouts',
  filters: {
    draft: { group: 'status', test: (r) => r.status === 'draft' },
    paid: { group: 'status', test: (r) => r.status === 'paid' },
    this_month: { group: 'date', test: (r, ctx) => r.day.slice(0, 7) === ctx.today.slice(0, 7) },
    mine: { group: 'who', test: (r, ctx) => r.by === ctx.userId },
  },
  groupBys: {
    merchant: (r) => ({ key: r.merchant, label: r.merchant }),
    status: (r) => ({ key: r.status, label: r.status }),
  },
  search: (r) => [r.merchant, `PAY-${r.id}`],
  sorts: { day: (r) => r.day, amount: (r) => r.amount },
  defaultSort: { key: 'day', desc: true },
  sums: ['amount'],
  defaultFilters: ['draft'],
};
const ctx = { today: '2026-11-07', userId: 'u1' };

describe('list state in the address', () => {
  it('round trips through search params', () => {
    const state = {
      ...EMPTY_LIST_STATE,
      q: 'nabta',
      filters: ['draft', 'paid'],
      groupBy: ['merchant', 'status'],
      sort: 'amount',
      desc: true,
      page: 3,
      pageSize: 100,
    };
    const text = serializeListState(state);
    expect(parseListState(new URLSearchParams(text))).toEqual(state);
  });

  it('leaves defaults out but always writes filters', () => {
    expect(serializeListState(EMPTY_LIST_STATE)).toBe('f=');
    const parsed = parseListState(new URLSearchParams('f='), {}, { filters: ['draft'] });
    expect(parsed.filters).toEqual([]);
    expect(parseListState(new URLSearchParams(''), {}, { filters: ['draft'] }).filters).toEqual([
      'draft',
    ]);
    expect(hasListState(new URLSearchParams('f='))).toBe(true);
    expect(hasListState({ tab: 'x' })).toBe(false);
  });

  it('drops unknown or malformed values and caps grouping at two levels', () => {
    const s = parseListState(
      { f: 'draft,nope,DROP TABLE', g: 'merchant,status,day', sort: 'evil', page: '-4', size: '7' },
      { filters: ['draft', 'paid'], groupBys: ['merchant', 'status'], sorts: ['day'] },
    );
    expect(s.filters).toEqual(['draft']);
    expect(s.groupBy).toEqual(['merchant', 'status']);
    expect(s.sort).toBeNull();
    expect(s.page).toBe(1);
    expect(s.pageSize).toBe(50);
  });

  it('toggles filters, groupings and sorting and goes back to page one', () => {
    let s = { ...EMPTY_LIST_STATE, page: 4 };
    s = toggleFilter(s, 'draft');
    expect(s).toMatchObject({ filters: ['draft'], page: 1 });
    expect(toggleFilter(s, 'draft').filters).toEqual([]);
    s = toggleGroupBy(toggleGroupBy(toggleGroupBy(s, 'a'), 'b'), 'c');
    expect(s.groupBy).toEqual(['b', 'c']);
    expect(toggleGroupBy(s, 'b').groupBy).toEqual(['c']);
    s = sortBy(s, 'amount');
    expect([s.sort, s.desc]).toEqual(['amount', false]);
    expect(sortBy(s, 'amount').desc).toBe(true);
  });
});

describe('facet chips', () => {
  const labels = {
    filters: { draft: 'Draft', paid: 'Paid', mine: 'Mine' },
    filterGroups: { draft: 'status', paid: 'status', mine: 'who' },
    groupBys: { merchant: 'Merchant', status: 'Status' },
    or: 'or',
  };
  it('makes one chip per filter group, one for the search and one for the grouping', () => {
    const state = {
      ...EMPTY_LIST_STATE,
      q: 'nab',
      filters: ['draft', 'mine', 'paid'],
      groupBy: ['merchant', 'status'],
    };
    const facets = facetsOf(state, labels);
    expect(facets.map((f) => [f.kind, f.values.join(f.joiner)])).toEqual([
      ['search', 'nab'],
      ['filter', 'Draft or Paid'],
      ['filter', 'Mine'],
      ['group', 'Merchant › Status'],
    ]);
    expect(facets[1]!.without.filters).toEqual(['mine']);
    expect(facets[3]!.without.groupBy).toEqual([]);
    expect(facets[0]!.without.q).toBe('');
  });
});

describe('runList', () => {
  it('ORs filters of one group and ANDs groups, with totals over every passing row', () => {
    const r = runList(rows, def, { ...EMPTY_LIST_STATE, filters: ['draft', 'paid'] }, ctx);
    expect(r.total).toBe(4);
    expect(r.totals.amount).toBe(3907);
    const mine = runList(rows, def, { ...EMPTY_LIST_STATE, filters: ['paid', 'mine'] }, ctx);
    expect(mine.rows.map((x) => x.id)).toEqual(['3']);
  });

  it('searches every word, ignoring case', () => {
    const r = runList(rows, def, { ...EMPTY_LIST_STATE, q: 'NILE pant' }, ctx);
    expect(r.rows.map((x) => x.id).sort()).toEqual(['3', '4']);
    expect(runList(rows, def, { ...EMPTY_LIST_STATE, q: 'pay-5' }, ctx).total).toBe(1);
  });

  it('sorts and pages', () => {
    const r = runList(rows, def, { ...EMPTY_LIST_STATE, sort: 'amount', pageSize: 25 }, ctx);
    expect(r.rows.map((x) => x.amount)).toEqual([7, 50, 400, 1000, 2500]);
    const d = runList(rows, def, EMPTY_LIST_STATE, ctx);
    expect(d.rows[0]!.id).toBe('5');
    const paged = runList(rows, def, { ...EMPTY_LIST_STATE, pageSize: 25, page: 9 }, ctx);
    expect(paged.page).toBe(1);
  });

  it('groups two levels with counts and subtotals, then opens one group', () => {
    const state = { ...EMPTY_LIST_STATE, groupBy: ['merchant', 'status'] };
    const r = runList(rows, def, state, ctx);
    expect(r.rows).toEqual([]);
    expect(r.totals.amount).toBe(3957);
    const nabta = r.groups!.find((g) => g.key === 'Nabta')!;
    expect(nabta).toMatchObject({ count: 2, totals: { amount: 3500 } });
    expect(nabta.groups!.map((g) => [g.key, g.totals.amount])).toEqual([
      ['draft', 1000],
      ['paid', 2500],
    ]);
    const opened = runList(rows, def, state, ctx, { open: ['Nabta', 'paid'] });
    expect(opened.rows.map((x) => x.id)).toEqual(['2']);
    expect(opened.totals.amount).toBe(2500);
  });

  it('returns every passing row for exports', () => {
    const r = runList(rows, def, { ...EMPTY_LIST_STATE, groupBy: ['merchant'] }, ctx, {
      all: true,
    });
    expect(r.rows).toHaveLength(5);
    expect(r.groups).toBeNull();
  });
});

describe('exports', () => {
  it('writes CSV with a byte order mark and neutralised formulas', () => {
    const text = exportCsv(
      ['a', 'b'],
      [
        ['=SUM(A1)', -60.42],
        ['x,y', null],
      ],
    );
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain("'=SUM(A1),-60.42");
    expect(text).toContain('"x,y",');
  });

  it('writes a valid stored zip for xlsx with the sheet inside', () => {
    expect(crc32(utf8('123456789'))).toBe(0xcbf43926);
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(27)).toBe('AB');
    const bytes = exportXlsx(['Name', 'EGP'], [['محمد & Co', 12.5]], { rtl: true });
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('xl/worksheets/sheet1.xml');
    expect(text).toContain('محمد &amp; Co');
    expect(text).toContain('<v>12.5</v>');
    expect(text).toContain('rightToLeft="1"');
  });
});

describe('document numbers', () => {
  it('reads every prefix in loose forms', () => {
    expect(parseDocNumber('PAY-000123')).toMatchObject({ kind: 'payout', number: 123 });
    expect(parseDocNumber(' pay 12 ')).toMatchObject({ kind: 'payout', number: 12 });
    expect(parseDocNumber('chq-7')).toMatchObject({ kind: 'cheque', number: 7 });
    expect(parseDocNumber('BILL000004')).toMatchObject({ kind: 'bill', number: 4 });
    expect(parseDocNumber('rw-1')?.kind).toBe('rider_withdrawal');
    expect(parseDocNumber('Nabta')).toBeNull();
    expect(parseDocNumber('XX-1')).toBeNull();
    expect(parseDocNumber('PAY-0')).toBeNull();
  });
});
