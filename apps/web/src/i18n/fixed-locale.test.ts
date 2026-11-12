import { describe, expect, it } from 'vitest';
import ar from '../../messages/ar.json';
import en from '../../messages/en.json';
import { translatorIn } from './fixed-locale';

describe('translatorIn', () => {
  it('answers in the language asked for, not the reader’s', async () => {
    const [tEn, tAr] = await Promise.all([
      translatorIn('en', 'finance'),
      translatorIn('ar', 'finance'),
    ]);
    expect(tAr('kinds.journal')).toBe(ar.finance.kinds.journal);
    expect(tEn('kinds.journal')).toBe(en.finance.kinds.journal);
    expect(tAr('kinds.journal')).not.toBe(tEn('kinds.journal'));
    expect(tAr.has('kinds.nothing_like_this')).toBe(false);
  });
});
