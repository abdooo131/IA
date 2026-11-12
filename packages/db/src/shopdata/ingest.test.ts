import { describe, expect, it } from 'vitest';
import { toPiastres, topCategory } from './ingest';

describe('shop data helpers', () => {
  it('turns Shopify amounts into piastres without floats', () => {
    expect(toPiastres('149.5')).toBe(14950);
    expect(toPiastres('0.07')).toBe(7);
    expect(toPiastres('12')).toBe(1200);
    expect(toPiastres('-3.25')).toBe(-325);
    expect(toPiastres('10.999')).toBe(1099);
    expect(toPiastres(null)).toBe(0);
    expect(toPiastres('abc')).toBe(0);
  });

  it('groups by the top of the taxonomy, then the product type', () => {
    expect(topCategory('Apparel & Accessories > Clothing > Dresses', 'Dress')).toBe(
      'Apparel & Accessories',
    );
    expect(topCategory(null, ' Perfume ')).toBe('Perfume');
    expect(topCategory(null, null)).toBe('Uncategorized');
  });
});
