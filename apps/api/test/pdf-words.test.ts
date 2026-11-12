import { describe, expect, it } from 'vitest';
import { visualWords } from '../src/common/pdf';

/** The words of a line read from the reading start (right in Arabic, left in English). */
const reading = (text: string, rtl: boolean) => {
  const words = visualWords(text, rtl).map((w) => w.word);
  return (rtl ? words.reverse() : words).join(' ');
};

describe('PDF word order', () => {
  it('keeps one separator on each side of a number inside an Arabic line', () => {
    // The voucher footer once read "شيبلي ناو · · JV-002577" with both dots together.
    const footer = 'شيبلي ناو · JV-002577 · صفحة 1 من 2';
    expect(reading(footer, true)).toBe(footer);
    const words = visualWords(footer, true).map((w) => w.word);
    const at = words.indexOf('JV-002577');
    expect(words[at - 1]).toBe('·');
    expect(words[at + 1]).toBe('·');
  });

  it('leaves English lines in their order', () => {
    const footer = 'Shiply Now · JV-000001 · page 1 of 2';
    expect(reading(footer, false)).toBe(footer);
  });
});
