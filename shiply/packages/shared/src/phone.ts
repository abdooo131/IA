// Egyptian mobiles: 01 then 0, 1, 2 or 5, then 8 digits. Stored as +201XXXXXXXXX.

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export function normalizeEgyptMobile(input: string): string | null {
  let d = input
    .replace(/[٠-٩]/g, (c) => String(ARABIC_DIGITS.indexOf(c)))
    .replace(/[۰-۹]/g, (c) => String(PERSIAN_DIGITS.indexOf(c)))
    .replace(/[\s\-().\u200e\u200f\u061c\u202a-\u202e]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('0020')) d = d.slice(4);
  else if (d.startsWith('20') && d.length === 12) d = d.slice(2);
  if (d.length === 10 && d.startsWith('1')) d = '0' + d;
  if (!/^01[0125]\d{8}$/.test(d)) return null;
  return '+20' + d.slice(1);
}
