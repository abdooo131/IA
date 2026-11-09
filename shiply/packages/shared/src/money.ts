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

/**
 * An amount as people type it: Arabic or Latin digits, thousands commas, spaces, the Arabic
 * decimal mark. "1,000" → 100000, "٩٥٠" → 95000, "١٢٫٥" → 1250.
 */
export function parseEgp(input: string | number): number {
  if (typeof input === 'number') return toPiastres(String(input));
  const s = input
    .trim()
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/٫/g, '.')
    .replace(/\s/g, '');
  // A comma is a thousands separator only; "12,50" is refused rather than read as 1,250.
  if (/[,،]/.test(s) && !/^-?\d{1,3}([,،]\d{3})+(\.\d+)?$/.test(s)) throw new Error(`not an amount: ${input}`);
  return toPiastres(s.replace(/[,،]/g, ''));
}
