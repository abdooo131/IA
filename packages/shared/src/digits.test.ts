import { describe, expect, it } from 'vitest';
import { egpTextToPiastres } from './contracts';
import { toLatinDigits } from './digits';
import { normalizeEgyptianPhone } from './phone';

describe('toLatinDigits', () => {
  it.each([
    ['٠١٢٣٤٥٦٧٨٩', '0123456789'],
    ['۰۱۲۳۴۵۶۷۸۹', '0123456789'],
    ['١٬٢٤٩٫٥٠', '1249.50'],
    ['abc 12', 'abc 12'],
    ['', ''],
  ])('%s gives %s', (input, expected) => {
    expect(toLatinDigits(input)).toBe(expected);
  });

  it('lets Arabic keyboard phones and amounts through', () => {
    expect(normalizeEgyptianPhone('٠١٠١٢٣٤٥٦٧٨')).toBe('+201012345678');
    expect(normalizeEgyptianPhone('+۲۰ ۱۱۱۲۳۴۵۶۷۸')).toBe('+201112345678');
    expect(egpTextToPiastres('١٬٢٠٠٫٥')).toBe(120050);
  });
});
