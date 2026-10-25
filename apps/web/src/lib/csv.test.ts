import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from './csv';

describe('parseCsv', () => {
  it('reads headers, quotes, Windows line ends and a byte order mark', () => {
    const text = `${String.fromCharCode(0xfeff)}SKU,Title_EN,price_egp\r\nA-1,"Bra, lace",249.50\r\n\r\nB-2,"Say ""hi""",10\r\n`;
    expect(parseCsv(text)).toEqual([
      { sku: 'A-1', title_en: 'Bra, lace', price_egp: '249.50' },
      { sku: 'B-2', title_en: 'Say "hi"', price_egp: '10' },
    ]);
  });

  it('accepts semicolons, which Excel uses in some regions', () => {
    expect(parseCsv('sku;title_en\nA;Arabic اسم')).toEqual([{ sku: 'A', title_en: 'Arabic اسم' }]);
  });

  it('round trips what toCsv writes', () => {
    const out = toCsv(['sku', 'title_ar'], [['X,1', 'قميص "أبيض"']]);
    expect(parseCsv(out)).toEqual([{ sku: 'X,1', title_ar: 'قميص "أبيض"' }]);
  });
});
