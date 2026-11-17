import { describe, expect, it, vi } from 'vitest';
import { newActionKey } from './ids';

describe('newActionKey', () => {
  it('is unique and long enough for the API', () => {
    const a = newActionKey();
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(newActionKey()).not.toBe(a);
  });

  it('still works where randomUUID is missing (plain http)', () => {
    const spy = vi.spyOn(crypto, 'randomUUID').mockImplementation(undefined as never);
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    expect(newActionKey()).toMatch(/^[0-9a-f]{32}$/);
    spy.mockRestore();
  });
});
