import { describe, expect, it } from 'vitest';
import ar from '../../messages/ar.json';
import en from '../../messages/en.json';

function keys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe('translations', () => {
  it('Arabic and English have exactly the same keys', () => {
    expect(keys(ar).sort()).toEqual(keys(en).sort());
  });

  it('never uses a dot inside a key, which next-intl refuses', () => {
    const own = (value: unknown): string[] =>
      typeof value === 'object' && value !== null
        ? Object.entries(value).flatMap(([k, v]) => [k, ...own(v)])
        : [];
    expect(own(en).filter((k) => k.includes('.'))).toEqual([]);
  });
});
