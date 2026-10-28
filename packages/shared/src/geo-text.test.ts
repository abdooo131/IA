import { describe, expect, it } from 'vitest';
import { containsWords, normalizeAddressText } from './geo-text';

describe('address text cleaning', () => {
  it('folds Arabic letter families, diacritics and digits', () => {
    expect(normalizeAddressText('التَّجمُّع الخامس، القاهرة الجديدة')).toBe(
      'التجمع الخامس القاهره الجديده',
    );
    expect(normalizeAddressText('مدينة نصر - عمارة ١٢')).toBe('مدينه نصر عماره 12');
    expect(normalizeAddressText('إمبابة')).toBe(normalizeAddressText('امبابه'));
  });

  it('lowercases Latin and turns punctuation into spaces', () => {
    expect(normalizeAddressText('Villa 12, South 90th St., New-Cairo')).toBe(
      'villa 12 south 90th st new cairo',
    );
  });

  it('matches names only as whole words', () => {
    const text = normalizeAddressText('12 Maadi Degla street');
    expect(containsWords(text, 'maadi')).toBe(true);
    expect(containsWords(text, 'maad')).toBe(false);
    expect(containsWords(text, 'maadi degla')).toBe(true);
  });
});
