import { z } from 'zod';

/**
 * Egyptian mobile numbers: 11 digits locally (01X XXXX XXXX), stored as +20 followed by
 * the 10 digits after the leading zero. Valid operator prefixes are 010, 011, 012 and 015.
 */
const LOCAL_MOBILE = /^01[0125]\d{8}$/;

export function normalizeEgyptianPhone(input: string): string | null {
  let digits = input.replace(/[\s\-().]/g, '');
  if (digits.startsWith('+20')) digits = '0' + digits.slice(3);
  else if (digits.startsWith('0020')) digits = '0' + digits.slice(4);
  else if (digits.startsWith('20') && digits.length === 12) digits = '0' + digits.slice(2);
  if (!LOCAL_MOBILE.test(digits)) return null;
  return '+20' + digits.slice(1);
}

export function isEgyptianPhone(input: string): boolean {
  return normalizeEgyptianPhone(input) !== null;
}

/** Accepts any common Egyptian format and outputs the normalized +20 form. */
export const egyptianPhoneSchema = z.string().transform((value, ctx) => {
  const normalized = normalizeEgyptianPhone(value);
  if (!normalized) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid_egyptian_phone' });
    return z.NEVER;
  }
  return normalized;
});
