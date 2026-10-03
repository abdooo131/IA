/**
 * Egyptian mobile numbers: 11 local digits starting with 010, 011, 012 or 015.
 * Accepts "01012345678", "+201012345678", "201012345678", "00201012345678" with spaces or dashes.
 * Returns the normalized E.164 form "+201012345678" or null when invalid.
 */
export function normalizeEgyptianPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = String(input).replace(/[\s\-().]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('0020')) digits = digits.slice(2);
  if (digits.startsWith('20') && digits.length === 12) digits = '0' + digits.slice(2);
  if (!/^\d+$/.test(digits)) return null;
  if (!/^01[0125]\d{8}$/.test(digits)) return null;
  return '+20' + digits.slice(1);
}

export function isValidEgyptianPhone(input: string | null | undefined): boolean {
  return normalizeEgyptianPhone(input) !== null;
}

/** Parse an EGP amount like "1,250.50" into integer piastres. Rejects floats beyond 2 decimals. */
export function egpToPiastres(input: string | number): number | null {
  const s = String(input).trim().replace(/,/g, '');
  if (s === '') return 0;
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const whole = parseInt(m[1], 10);
  const frac = m[2] ? parseInt(m[2].padEnd(2, '0'), 10) : 0;
  return whole * 100 + frac;
}

export function formatPiastres(p: number, lang: 'en' | 'ar' = 'en'): string {
  const neg = p < 0;
  const abs = Math.abs(p);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const frac = String(abs % 100).padStart(2, '0');
  const amount = `${neg ? '-' : ''}${whole}.${frac}`;
  return lang === 'ar' ? `${amount} ج.م` : `EGP ${amount}`;
}

/** Luhn mod 10 check digit over a string of digits. */
export function luhnCheckDigit(digits: string): number {
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

/** Tracking numbers look like SHP + 9 digit sequence + 1 Luhn check digit, e.g. SHP0000000123X. */
export function buildTrackingNumber(prefix: string, sequence: number): string {
  const body = String(sequence).padStart(9, '0');
  return `${prefix}${body}${luhnCheckDigit(body)}`;
}

export function isValidTrackingNumber(prefix: string, tn: string): boolean {
  if (!tn.startsWith(prefix)) return false;
  const rest = tn.slice(prefix.length);
  if (!/^\d{10}$/.test(rest)) return false;
  return luhnCheckDigit(rest.slice(0, 9)) === parseInt(rest[9], 10);
}
