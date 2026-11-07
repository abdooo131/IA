import { describe, expect, it } from 'vitest';
import { parseStatementAmount, parseStatementDate } from './statement';

describe('bank statement cells', () => {
  it('reads dates the way Egyptian banks write them', () => {
    expect(parseStatementDate('01/11/2026')).toBe('2026-11-01');
    expect(parseStatementDate('1-11-26')).toBe('2026-11-01');
    expect(parseStatementDate('2026-11-01T00:00:00')).toBe('2026-11-01');
    expect(parseStatementDate('01-Nov-2026')).toBe('2026-11-01');
    expect(parseStatementDate('5 September 2026')).toBe('2026-09-05');
    expect(parseStatementDate('٠١/١١/٢٠٢٦')).toBe('2026-11-01');
    expect(parseStatementDate('46327')).toBe('2026-11-01');
    expect(parseStatementDate('31/02/2026')).toBeNull();
    expect(parseStatementDate('Opening balance')).toBeNull();
  });

  it('reads amounts to the piastre without floats', () => {
    expect(parseStatementAmount('1,234.50')).toBe(123_450);
    expect(parseStatementAmount('(500.00)')).toBe(-50_000);
    expect(parseStatementAmount('-20')).toBe(-2_000);
    expect(parseStatementAmount('300.00 CR')).toBe(30_000);
    expect(parseStatementAmount('300.00 DR')).toBe(-30_000);
    expect(parseStatementAmount('EGP 12.5')).toBe(1_250);
    expect(parseStatementAmount('0.1')).toBe(10);
    expect(parseStatementAmount('19.999')).toBe(1_999);
    expect(parseStatementAmount('')).toBeNull();
    expect(parseStatementAmount('abc')).toBeNull();
  });
});
