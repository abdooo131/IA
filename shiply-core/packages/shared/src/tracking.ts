// Tracking numbers: prefix + 9 digit sequence + 1 Luhn check digit, e.g. SHP0000010005.
// The check digit catches most typing and scanning mistakes before we hit the database.

export function luhnDigit(digits: string): number {
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

export function makeTrackingNumber(prefix: string, sequence: number): string {
  const body = String(sequence).padStart(9, '0');
  return `${prefix}${body}${luhnDigit(body)}`;
}

export function isValidTrackingNumber(value: string, prefix: string): boolean {
  if (!value.startsWith(prefix)) return false;
  const rest = value.slice(prefix.length);
  if (!/^\d{10}$/.test(rest)) return false;
  return luhnDigit(rest.slice(0, 9)) === Number(rest[9]);
}

/** Scanners and people add spaces or lower case letters. */
export function normalizeCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}
