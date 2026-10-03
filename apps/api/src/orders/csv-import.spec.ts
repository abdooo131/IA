import { parseBool, parseSize, parseType } from './csv-import.service';
import { nextCashout } from './orders.service';

describe('CSV value parsing', () => {
  it('parses sizes from enum or friendly names', () => {
    expect(parseSize('Small/Medium')).toBe('SMALL_MEDIUM');
    expect(parseSize('LARGE')).toBe('LARGE');
    expect(parseSize('xl')).toBe('XLARGE');
    expect(parseSize('heavy bulky')).toBe('HEAVY_BULKY');
    expect(parseSize('')).toBeUndefined();
    expect(parseSize('huge')).toBeNull();
  });
  it('parses types', () => {
    expect(parseType('')).toBe('DELIVER');
    expect(parseType('exchange')).toBe('EXCHANGE');
    expect(parseType('swap')).toBeNull();
  });
  it('parses yes/no in English and Arabic', () => {
    expect(parseBool('Yes')).toBe(true);
    expect(parseBool('لا')).toBe(false);
    expect(parseBool('')).toBeUndefined();
    expect(parseBool('maybe')).toBeNull();
  });
});

describe('next cashout date', () => {
  const wed = new Date('2026-10-07T10:00:00Z');
  it('daily is tomorrow', () => expect(nextCashout('DAILY', wed).toISOString().slice(0, 10)).toBe('2026-10-08'));
  it('every 2 days', () => expect(nextCashout('EVERY_2_DAYS', wed).toISOString().slice(0, 10)).toBe('2026-10-09'));
  it('weekly is next Sunday', () => expect(nextCashout('WEEKLY', wed).toISOString().slice(0, 10)).toBe('2026-10-11'));
});
