import { describe, expect, it } from 'vitest';
import { firstOpenDay, inClosedBooks } from './books-lock';

describe('books lock in forms', () => {
  it('opens the day after the closed day, across a month end', () => {
    expect(firstOpenDay({ closedThrough: '2026-10-31' })).toBe('2026-11-01');
    expect(firstOpenDay(null)).toBeNull();
  });

  it('refuses days before the first open day only', () => {
    expect(inClosedBooks('2026-10-31', '2026-11-01')).toBe(true);
    expect(inClosedBooks('2026-11-01', '2026-11-01')).toBe(false);
    expect(inClosedBooks('2026-01-01', null)).toBe(false);
    expect(inClosedBooks('', '2026-11-01')).toBe(false);
  });
});
