import { toLatinDigits } from '@shiplynow/shared';

/** Only the digits of what was typed (Arabic keyboard digits included), at most `max`. */
export function digitsOnly(text: string, max?: number): string {
  const digits = toLatinDigits(text).replace(/\D/g, '');
  return max === undefined ? digits : digits.slice(0, max);
}

/** Number boxes (quantities, codes, phones, amounts, percents) take Latin digits as typed. */
export function wantsLatinDigits(input: { type: string; inputMode: string }): boolean {
  return (
    input.type === 'tel' ||
    input.inputMode === 'numeric' ||
    input.inputMode === 'decimal' ||
    input.inputMode === 'tel'
  );
}

/**
 * The value and caret of a number box once its Arabic keyboard digits are Latin, or null when
 * nothing changes.
 */
export function latinInput(
  value: string,
  caret: number | null,
): { value: string; caret: number | null } | null {
  const latin = toLatinDigits(value);
  if (latin === value) return null;
  return {
    value: latin,
    caret: caret === null ? null : toLatinDigits(value.slice(0, caret)).length,
  };
}
