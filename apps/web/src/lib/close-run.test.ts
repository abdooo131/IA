import { MONTH_END_ITEMS, type MonthEndItem } from '@shiplynow/shared';
import { describe, expect, it } from 'vitest';
import type { MonthEndChecklist } from './cash-control-types';
import {
  canTickItem,
  CLOSE_STEPS,
  closeProgress,
  closeStepOf,
  firstOpenStep,
  monthEndFixHref,
  nextOpenStep,
} from './close-run';

const list = (done: MonthEndItem[], extra: Partial<MonthEndChecklist> = {}): MonthEndChecklist => ({
  month: '2026-10',
  lastDay: '2026-10-31',
  over: true,
  closedThrough: null,
  readyToClose: false,
  items: MONTH_END_ITEMS.map((id) => ({
    id,
    automatic: id !== 'vat_return' && id !== 'books_closed',
    left: done.includes(id) ? 0 : 2,
    notYet: false,
    done: done.includes(id),
    mark: null,
  })),
  ...extra,
});

describe('the Close the month run', () => {
  it('has a step per checklist item before the books, then closing', () => {
    expect(CLOSE_STEPS.at(-1)).toBe('close');
    expect(CLOSE_STEPS).not.toContain('books_closed');
    expect(CLOSE_STEPS).toHaveLength(MONTH_END_ITEMS.length);
  });

  it('opens on the first open item, or closing when all are done', () => {
    expect(firstOpenStep(list(['cash_handovers']))).toBe('bank_lines');
    const all = MONTH_END_ITEMS.filter((i) => i !== 'books_closed');
    expect(firstOpenStep(list(all))).toBe('close');
    expect(closeStepOf(list([]), 'receipts')).toBe('receipts');
    expect(closeStepOf(list([]), 'books_closed')).toBe('cash_handovers');
    expect(closeStepOf(list([]), 'nonsense')).toBe('cash_handovers');
  });

  it('skips done items when moving on', () => {
    const l = list(['bank_lines', 'receipts']);
    expect(nextOpenStep(l, 'cash_handovers')).toBe('petty_cash');
    expect(nextOpenStep(l, 'vat_return')).toBe('close');
    expect(closeProgress(l)).toEqual({ done: 2, total: MONTH_END_ITEMS.length - 1 });
  });

  it('links each item to the screen that fixes it, with the month where it takes one', () => {
    for (const i of MONTH_END_ITEMS) expect(monthEndFixHref(i, '2026-10')).toMatch(/^\/finance\//);
    expect(monthEndFixHref('bank_lines', '2026-10')).toBe('/finance/bank?month=2026-10');
    expect(monthEndFixHref('vat_return', '2026-10')).toBe('/finance/taxes?tab=returns');
  });

  it('never offers a hand tick on the books or on an item done by itself', () => {
    const l = list(['bank_lines']);
    const item = (id: MonthEndItem) => l.items.find((i) => i.id === id)!;
    expect(canTickItem(item('books_closed'))).toBe(false);
    expect(canTickItem(item('bank_lines'))).toBe(false);
    expect(canTickItem(item('receipts'))).toBe(true);
    expect(
      canTickItem({ ...item('vat_return'), mark: { note: 'filed', by: 'A', at: '2026-11-01' } }),
    ).toBe(false);
  });
});
