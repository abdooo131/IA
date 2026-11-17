import { describe, expect, it } from 'vitest';
import {
  bucketCash,
  cashAgeBucket,
  heldPieces,
  monthEndMarkSchema,
  nextPayoutDay,
  pettyCashLabel,
  pettyCashSchema,
  shiftMonth,
} from './cash-control';

const at = (h: number) => new Date(Date.UTC(2026, 10, 6, h));

describe('rider cash age', () => {
  it('keeps the newest collections as the cash still held', () => {
    const collections = [
      { amountPiastres: 5_000, at: at(10) },
      { amountPiastres: 3_000, at: at(6) },
      { amountPiastres: 4_000, at: at(2) },
    ];
    expect(heldPieces(6_000, collections)).toEqual([
      { amountPiastres: 5_000, at: at(10) },
      { amountPiastres: 1_000, at: at(6) },
    ]);
    expect(heldPieces(0, collections)).toEqual([]);
    // More than was ever collected (an old charge): the rest counts as old money.
    expect(heldPieces(13_000, collections).at(-1)).toEqual({
      amountPiastres: 1_000,
      at: new Date(0),
    });
  });

  it('sorts cash into fresh, getting old and overdue', () => {
    expect(cashAgeBucket(3 * 3_600_000, 4, 12)).toBe('fresh');
    expect(cashAgeBucket(4 * 3_600_000, 4, 12)).toBe('aging');
    expect(cashAgeBucket(12 * 3_600_000, 4, 12)).toBe('aging');
    expect(cashAgeBucket(12 * 3_600_000 + 1, 4, 12)).toBe('overdue');
    const now = at(20);
    expect(
      bucketCash(
        [
          { amountPiastres: 100, at: at(19) },
          { amountPiastres: 200, at: at(10) },
          { amountPiastres: 300, at: at(1) },
        ],
        now,
        4,
        12,
      ),
    ).toEqual({ fresh: 100, aging: 200, overdue: 300 });
  });
});

describe('payout days', () => {
  it('finds the next day each schedule pays', () => {
    // 2026-11-06 is a Friday.
    expect(nextPayoutDay('daily', '2026-11-06')).toBe('2026-11-06');
    expect(nextPayoutDay('weekly', '2026-11-06')).toBe('2026-11-08');
    expect(nextPayoutDay('twice_weekly', '2026-11-06')).toBe('2026-11-08');
    expect(nextPayoutDay('twice_weekly', '2026-11-09')).toBe('2026-11-11');
    expect(nextPayoutDay('weekly', '2026-11-08')).toBe('2026-11-08');
  });
});

describe('petty cash and month end', () => {
  it('labels and checks petty cash', () => {
    expect(pettyCashLabel(7)).toBe('PC-000007');
    const ok = {
      expenseAccountId: 'acc',
      amountPiastres: 2_500,
      note: 'Tape',
      photoId: 'photo',
      idempotencyKey: 'key-12345',
    };
    expect(pettyCashSchema.safeParse(ok).success).toBe(true);
    expect(pettyCashSchema.safeParse({ ...ok, amountPiastres: 12.5 }).success).toBe(false);
    expect(pettyCashSchema.safeParse({ ...ok, photoId: '' }).success).toBe(false);
  });

  it('never ticks the books closed by hand and moves months', () => {
    expect(monthEndMarkSchema.safeParse({ item: 'vat_return', note: 'Filed' }).success).toBe(true);
    expect(monthEndMarkSchema.safeParse({ item: 'books_closed', note: 'Filed' }).success).toBe(
      false,
    );
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-11', 2)).toBe('2027-01');
  });
});
