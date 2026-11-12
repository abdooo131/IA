import { describe, expect, it } from 'vitest';
import {
  agingBand,
  bucketsOf,
  daysBetweenDays,
  debitNoteSchema,
  openDebits,
  reminderDue,
} from './aging';

describe('aging bands', () => {
  it('counts Cairo calendar days and bands them', () => {
    expect(daysBetweenDays('2026-10-01', '2026-10-31')).toBe(30);
    expect(daysBetweenDays('2026-10-31', '2026-10-01')).toBe(-30);
    expect([-3, 0, 1, 30, 31, 60, 61, 90, 91].map(agingBand)).toEqual([
      'current',
      'current',
      'd1_30',
      'd1_30',
      'd31_60',
      'd31_60',
      'd61_90',
      'd61_90',
      'over_90',
    ]);
  });
});

describe('first in, first out', () => {
  it('pays the oldest debits first and keeps the rest with their day', () => {
    const { open, credit } = openDebits([
      { amount: 1_000, day: '2026-06-01' },
      { amount: 500, day: '2026-08-01' },
      { amount: -1_200, day: '2026-09-01' },
      { amount: 300, day: '2026-10-01' },
    ]);
    expect(credit).toBe(0);
    expect(open).toEqual([
      { amount: 300, day: '2026-08-01' },
      { amount: 300, day: '2026-10-01' },
    ]);
    expect(bucketsOf(open, '2026-10-01')).toEqual({
      current: 300,
      d1_30: 0,
      d31_60: 0,
      d61_90: 300,
      over_90: 0,
    });
  });

  it('lets earlier credit pay later debits and leaves nothing open in credit', () => {
    expect(
      openDebits([
        { amount: -800, day: '2026-01-01' },
        { amount: 500, day: '2026-02-01' },
      ]),
    ).toEqual({ open: [], credit: 300 });
    expect(
      openDebits([
        { amount: -800, day: '2026-01-01' },
        { amount: 1_000, day: '2026-02-01' },
      ]).open,
    ).toEqual([{ amount: 200, day: '2026-02-01' }]);
  });
});

describe('reminder schedule', () => {
  const rules = { firstDays: 3, everyDays: 7, max: 2 };
  it('waits the first days, then every few days, up to the max', () => {
    const at = (today: string, sent = 0, lastDay: string | null = null) =>
      reminderDue({ sinceDay: '2026-10-01', today, sent, lastDay }, rules);
    expect(at('2026-10-03')).toBe(false);
    expect(at('2026-10-04')).toBe(true);
    expect(at('2026-10-10', 1, '2026-10-04')).toBe(false);
    expect(at('2026-10-11', 1, '2026-10-04')).toBe(true);
    expect(at('2026-12-01', 2, '2026-10-11')).toBe(false);
  });
});

describe('debit note request', () => {
  it('needs a reason and positive amounts of known fee kinds', () => {
    const ok = debitNoteSchema.safeParse({
      lines: [{ kind: 'storage_fee', netPiastres: 1_000 }],
      reason: 'Storage days missed in October',
      idempotencyKey: 'abcdefgh',
    });
    expect(ok.success && ok.data.lines[0]!.quantity).toBe(1);
    expect(
      debitNoteSchema.safeParse({
        lines: [{ kind: 'cod_collected', netPiastres: 1_000 }],
        reason: 'Storage days missed',
        idempotencyKey: 'abcdefgh',
      }).success,
    ).toBe(false);
    expect(
      debitNoteSchema.safeParse({
        lines: [{ kind: 'storage_fee', netPiastres: 0 }],
        reason: 'x',
        idempotencyKey: 'abcdefgh',
      }).success,
    ).toBe(false);
  });
});
