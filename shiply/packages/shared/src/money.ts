// Money is whole piastres (1 EGP = 100 piastres). Never floats.

/** "12.5" → 1250. Refuses more than 2 decimals and anything that is not a number. */
export function toPiastres(egp: string): number {
  const s = egp.trim();
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`Not an EGP amount: ${egp}`);
  const sign = m[1] === '-' ? -1 : 1;
  const pounds = Number(m[2]);
  const piastres = Number((m[3] ?? '').padEnd(2, '0'));
  return sign * (pounds * 100 + piastres);
}

/** 1250 → "EGP 12.50" (English) or "12.50 ج.م" (Arabic). */
export function formatEgp(p: number, locale: 'ar' | 'en'): string {
  if (!Number.isInteger(p)) throw new Error('Piastres must be a whole number');
  const sign = p < 0 ? '-' : '';
  const abs = Math.abs(p);
  const text = `${sign}${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
  return locale === 'en' ? `EGP ${text}` : `${text} ج.م`;
}
