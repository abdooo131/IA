import { randomInt } from 'node:crypto';

function luhn(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

/** "SP" + 9 digits + a check digit, so a mistyped or misread number is caught. */
export function newTracking(): string {
  const body = String(randomInt(0, 1_000_000_000)).padStart(9, '0');
  return `SP${body}${luhn(body)}`;
}

export function isTracking(code: string): boolean {
  const m = /^SP(\d{9})(\d)$/.exec(code.trim().toUpperCase());
  return !!m && luhn(m[1]!) === Number(m[2]);
}
