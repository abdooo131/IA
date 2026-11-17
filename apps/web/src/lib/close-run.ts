import { MONTH_END_ITEMS, type MonthEndItem } from '@shiplynow/shared';
import type { MonthEndChecklist } from './cash-control-types';

// The guided "Close the month" run (Accounting UX phase B): the month end checklist one item at
// a time, each with the screen that fixes it, then closing the books through the existing lock.
// Nothing here decides a rule: the checklist (packages/db monthEndChecklist) says what is done.

/** The run's steps: every checklist item but the last, then closing the books. */
export const CLOSE_STEPS = [
  ...MONTH_END_ITEMS.filter((i) => i !== 'books_closed'),
  'close',
] as const satisfies readonly (MonthEndItem | 'close')[];
export type CloseStep = (typeof CLOSE_STEPS)[number];

/** Where each item is fixed; the month goes along where the screen takes one. */
export function monthEndFixHref(item: MonthEndItem, month: string): string {
  switch (item) {
    case 'cash_handovers':
      return '/finance/cash';
    case 'bank_lines':
      return `/finance/bank?month=${month}`;
    case 'receipts':
      return '/finance/receipts';
    case 'petty_cash':
      return '/finance/petty-cash?status=pending';
    case 'invoices':
      return '/finance/invoices';
    case 'payroll':
      return '/finance/payroll';
    case 'storage':
      return '/finance/journal';
    case 'depreciation':
      return '/finance/assets';
    case 'vat_return':
      return '/finance/taxes?tab=returns';
    case 'books_closed':
      return `/finance/month-end/run?month=${month}&step=close`;
  }
}

type Item = MonthEndChecklist['items'][number];

/** Whether an item can be ticked by hand now (never the books; not when already done). */
export function canTickItem(item: Item) {
  return item.id !== 'books_closed' && !item.mark && !(item.done && item.automatic);
}

/** The first item still open, or closing when everything before it is done. */
export function firstOpenStep(list: MonthEndChecklist): CloseStep {
  const open = list.items.find((i) => i.id !== 'books_closed' && !i.done);
  return open ? (open.id as CloseStep) : 'close';
}

/** The step the address names, or the first open one. */
export function closeStepOf(list: MonthEndChecklist, param: string | undefined): CloseStep {
  const named = CLOSE_STEPS.find((s) => s === param);
  return named ?? firstOpenStep(list);
}

/** The next step still open after a step (wrapping to closing). */
export function nextOpenStep(list: MonthEndChecklist, from: CloseStep): CloseStep {
  const at = CLOSE_STEPS.indexOf(from);
  for (const s of CLOSE_STEPS.slice(at + 1)) {
    if (s === 'close') return s;
    if (!list.items.find((i) => i.id === s)?.done) return s;
  }
  return 'close';
}

/** Done and total of the items before closing, for the progress bar. */
export function closeProgress(list: MonthEndChecklist) {
  const items = list.items.filter((i) => i.id !== 'books_closed');
  return { done: items.filter((i) => i.done).length, total: items.length };
}
