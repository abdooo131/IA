import { describe, expect, it } from 'vitest';
import { egyptianPhoneSchema, isEgyptianPhone, normalizeEgyptianPhone } from './phone';

describe('normalizeEgyptianPhone', () => {
  it.each([
    ['01012345678', '+201012345678'],
    ['+201112345678', '+201112345678'],
    ['00201212345678', '+201212345678'],
    ['201512345678', '+201512345678'],
    ['010 1234 5678', '+201012345678'],
    ['+20 (10) 1234-5678', '+201012345678'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeEgyptianPhone(input)).toBe(expected);
  });

  it.each([
    '0101234567', // 10 digits
    '010123456789', // 12 digits
    '01312345678', // unknown operator prefix
    '0223456789', // landline
    '+441012345678', // not Egypt
    'abc',
    '',
  ])('rejects %s', (input) => {
    expect(normalizeEgyptianPhone(input)).toBeNull();
    expect(isEgyptianPhone(input)).toBe(false);
  });
});

describe('egyptianPhoneSchema', () => {
  it('outputs the normalized form', () => {
    expect(egyptianPhoneSchema.parse('01012345678')).toBe('+201012345678');
  });

  it('fails with a stable error code', () => {
    const result = egyptianPhoneSchema.safeParse('123');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('invalid_egyptian_phone');
  });
});
