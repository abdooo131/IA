import { describe, expect, it } from 'vitest';
import { atLeast, defineMachine, formatEgp, normalizeEgyptMobile, TILES, toPiastres } from './index';

describe('money', () => {
  it('converts EGP text to whole piastres', () => {
    expect(toPiastres('12.5')).toBe(1250);
    expect(toPiastres('7')).toBe(700);
    expect(() => toPiastres('1.234')).toThrow();
    expect(() => toPiastres('abc')).toThrow();
  });
  it('formats piastres as EGP', () => {
    expect(formatEgp(1250, 'en')).toBe('EGP 12.50');
  });
});

describe('phone', () => {
  it('normalizes Egyptian mobiles in any form', () => {
    expect(normalizeEgyptMobile('٠١٠١٢٣٤٥٦٧٨')).toBe('+201012345678');
    expect(normalizeEgyptMobile('0101 234 5678')).toBe('+201012345678');
    expect(normalizeEgyptMobile('+20 1012345678')).toBe('+201012345678');
    expect(normalizeEgyptMobile('00201012345678')).toBe('+201012345678');
  });
  it('refuses landlines and wrong lengths', () => {
    expect(normalizeEgyptMobile('0201234567')).toBeNull();
    expect(normalizeEgyptMobile('010123')).toBeNull();
  });
});

describe('status machine', () => {
  it('allows only listed changes', () => {
    const m = defineMachine({ a: ['b'], b: [] } as const);
    expect(m.can('a', 'b')).toBe(true);
    expect(m.can('b', 'a')).toBe(false);
    expect(() => m.assert('b', 'a')).toThrow();
  });
});

describe('access', () => {
  it('has the 12 apps and ordered levels', () => {
    expect(TILES).toHaveLength(12);
    expect(atLeast('use', 'view')).toBe(true);
    expect(atLeast('view', 'manage')).toBe(false);
    expect(atLeast('none', 'none')).toBe(true);
  });
});
