import { describe, expect, it } from 'vitest';
import { parseEgp } from './money';

describe('parseEgp', () => {
  it('turns typed pounds into whole piastres', () => {
    expect(parseEgp('1,249.5')).toBe(124950);
    expect(parseEgp(' 10 ')).toBe(1000);
    expect(parseEgp('0.05')).toBe(5);
    expect(parseEgp('0.1')).toBe(10);
  });
  it('refuses what is not an amount', () => {
    expect(parseEgp('')).toBeNull();
    expect(parseEgp('1.234')).toBeNull();
    expect(parseEgp('abc')).toBeNull();
    expect(parseEgp('-5')).toBeNull();
    expect(parseEgp('-5', { allowNegative: true })).toBe(-500);
  });
});
