import { isCalendarDay } from '@shiplynow/shared';
import { parseEgp } from './money';

// The "Record an expense" quick form (Accounting UX phase B) builds the same body as the
// expense on Money movements (POST /finance/expenses); the API applies every rule (money in
// the account, the books lock, the second person from the approval limit).

export interface QuickExpenseFields {
  amount: string;
  vat: string;
  category: string;
  from: string;
  store: string;
  day: string;
  reference: string;
  note: string;
  receiptPhotoId: string;
}

export type QuickExpenseError =
  'amount' | 'vat' | 'vat_above_amount' | 'category' | 'from' | 'day' | 'future_day' | 'note';

export interface QuickExpenseBody {
  expenseAccountId: string;
  paidFromAccountId: string;
  amountPiastres: number;
  vatPiastres: number;
  reference: string;
  memo: string;
  day?: string;
  darkStoreId?: string;
  receiptPhotoId?: string;
}

/**
 * Checks the form and builds the expense body. The reference is optional on this form: when
 * empty, the note is used (the expense posting needs one).
 */
export function quickExpenseBody(
  f: QuickExpenseFields,
  today: string,
): { ok: true; value: QuickExpenseBody } | { ok: false; error: QuickExpenseError } {
  const amount = parseEgp(f.amount.trim());
  if (!amount || amount <= 0) return { ok: false, error: 'amount' };
  let vat = 0;
  if (f.vat.trim()) {
    const v = parseEgp(f.vat.trim());
    if (v === null || v < 0) return { ok: false, error: 'vat' };
    vat = v;
  }
  if (vat >= amount) return { ok: false, error: 'vat_above_amount' };
  if (!f.category) return { ok: false, error: 'category' };
  if (!f.from) return { ok: false, error: 'from' };
  const day = f.day.trim();
  if (day && !isCalendarDay(day)) return { ok: false, error: 'day' };
  if (day && day > today) return { ok: false, error: 'future_day' };
  const note = f.note.trim();
  if (note.length < 3) return { ok: false, error: 'note' };
  const reference = (f.reference.trim() || note).slice(0, 100);
  return {
    ok: true,
    value: {
      expenseAccountId: f.category,
      paidFromAccountId: f.from,
      amountPiastres: amount,
      vatPiastres: vat,
      reference: reference.length >= 2 ? reference : note,
      memo: note.slice(0, 300),
      ...(day && day !== today ? { day } : {}),
      ...(f.store ? { darkStoreId: f.store } : {}),
      ...(f.receiptPhotoId ? { receiptPhotoId: f.receiptPhotoId } : {}),
    },
  };
}
