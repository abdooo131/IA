import { describe, expect, it } from 'vitest';
import { quickExpenseBody } from './quick-expense';

const base = {
  amount: '114',
  vat: '',
  category: 'cat',
  from: 'bank',
  store: '',
  day: '2026-11-09',
  reference: '',
  note: 'Office water',
  receiptPhotoId: '',
};
const today = '2026-11-09';

describe('the Record an expense form', () => {
  it('builds the expense body in piastres, today without a day, the note as the reference', () => {
    expect(quickExpenseBody(base, today)).toEqual({
      ok: true,
      value: {
        expenseAccountId: 'cat',
        paidFromAccountId: 'bank',
        amountPiastres: 11_400,
        vatPiastres: 0,
        reference: 'Office water',
        memo: 'Office water',
      },
    });
  });

  it('keeps VAT, the store, a past day, the reference and the receipt', () => {
    const r = quickExpenseBody(
      {
        ...base,
        vat: '14',
        store: 's1',
        day: '2026-11-01',
        reference: 'R-77',
        receiptPhotoId: 'p1',
      },
      today,
    );
    expect(r).toMatchObject({
      ok: true,
      value: {
        vatPiastres: 1_400,
        darkStoreId: 's1',
        day: '2026-11-01',
        reference: 'R-77',
        receiptPhotoId: 'p1',
      },
    });
  });

  it('refuses what the API would refuse, before sending', () => {
    const err = (f: Partial<typeof base>) => {
      const r = quickExpenseBody({ ...base, ...f }, today);
      return r.ok ? null : r.error;
    };
    expect(err({ amount: '' })).toBe('amount');
    expect(err({ amount: '0' })).toBe('amount');
    expect(err({ vat: 'x' })).toBe('vat');
    expect(err({ vat: '114' })).toBe('vat_above_amount');
    expect(err({ category: '' })).toBe('category');
    expect(err({ from: '' })).toBe('from');
    expect(err({ day: '2026-11-10' })).toBe('future_day');
    expect(err({ note: 'ab' })).toBe('note');
  });
});
