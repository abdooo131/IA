import { describe, expect, it } from 'vitest';
import { formatCount, formatEgp } from './format';

describe('formatEgp', () => {
  it('turns integer piastres into pounds without float drift', () => {
    expect(formatEgp(32500)).toBe('325.00');
    expect(formatEgp(149900)).toBe('1,499.00');
    expect(formatEgp(5)).toBe('0.05');
    expect(formatEgp(0)).toBe('0.00');
  });
});

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(12345)).toBe('12,345');
  });
});
