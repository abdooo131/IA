// Money is always an integer number of piastres (1 EGP = 100 piastres). Never floats.

/** Multiply by basis points (10000 = 100%) and round half up, in integers only. */
export function applyBp(amount: number, bp: number): number {
  if (!Number.isInteger(amount) || !Number.isInteger(bp)) throw new Error('applyBp needs integers');
  const product = amount * bp;
  const sign = product < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(product) + 5000) / 10000);
}

/** "125.50" or "125" (EGP, as typed by a person) to piastres. Returns null when not valid. */
export function egpToPiastres(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, frac = ''] = trimmed.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** Piastres to "1,250.50 EGP" for display. */
export function formatEgp(piastres: number): string {
  const negative = piastres < 0;
  const abs = Math.abs(piastres);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const frac = String(abs % 100).padStart(2, '0');
  return `${negative ? '−' : ''}${whole}.${frac} EGP`;
}
