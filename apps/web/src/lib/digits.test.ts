import { describe, expect, it } from 'vitest';
import { digitsOnly, latinInput, wantsLatinDigits } from './digits';

describe('digits typed on an Arabic keyboard', () => {
  it('keep the rider delivery code readable', () => {
    expect(digitsOnly('١٢٣٤')).toBe('1234');
    expect(digitsOnly('۱۲۳۴۵', 4)).toBe('1234');
    expect(digitsOnly('12a3')).toBe('123');
  });

  it('turn into Latin digits in number boxes with the caret kept in place', () => {
    expect(latinInput('12', 2)).toBeNull();
    expect(latinInput('١٢٣', 2)).toEqual({ value: '123', caret: 2 });
    expect(latinInput('١٬٢٠٠', 5)).toEqual({ value: '1200', caret: 4 });
    expect(latinInput('٥', null)).toEqual({ value: '5', caret: null });
  });

  it('apply to number, code, phone and amount boxes only', () => {
    expect(wantsLatinDigits({ type: 'text', inputMode: 'numeric' })).toBe(true);
    expect(wantsLatinDigits({ type: 'text', inputMode: 'decimal' })).toBe(true);
    expect(wantsLatinDigits({ type: 'tel', inputMode: '' })).toBe(true);
    expect(wantsLatinDigits({ type: 'text', inputMode: '' })).toBe(false);
    expect(wantsLatinDigits({ type: 'email', inputMode: 'email' })).toBe(false);
  });
});
