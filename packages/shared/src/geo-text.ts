// Address text cleaning for the area engine. Arabic and English addresses in Egypt are written
// many ways ("التجمع الخامس", "التجمع الخامس.", "5th Settlement", "Tagamoa 5"), so both the
// address and every area name go through the same cleaning before they are compared.

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/**
 * Lowercase, Latin digits, one form for each Arabic letter family (alef, ya, ta marbuta,
 * hamza seats), no diacritics or tatweel, punctuation as spaces, single spaces.
 */
export function normalizeAddressText(input: string): string {
  let s = input.toLowerCase();
  s = s.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
  s = s.replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)));
  s = s
    .replace(/[ً-ْٰـ]/g, '') // diacritics and tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');
  // Latin spelling noise: "el-", "al-", "el " are kept as words; hyphens and dots become spaces.
  s = s.replace(/[^\p{L}\p{N}]+/gu, ' ');
  return s.trim().replace(/\s+/g, ' ');
}

/** Words that never name a place on their own, so they are never taught as area names. */
export const ADDRESS_FILLER = new Set([
  'street',
  'st',
  'road',
  'rd',
  'building',
  'bldg',
  'floor',
  'flat',
  'apt',
  'apartment',
  'villa',
  'block',
  'no',
  'number',
  'egypt',
  'cairo',
  'giza',
  'governorate',
  'city',
  'district',
  'near',
  'beside',
  'behind',
  'in',
  'of',
  'the',
  'and',
  'شارع',
  'ش',
  'طريق',
  'عماره',
  'عمارة',
  'برج',
  'دور',
  'الدور',
  'شقه',
  'فيلا',
  'بلوك',
  'رقم',
  'مصر',
  'محافظه',
  'مدينه',
  'حي',
  'بجوار',
  'امام',
  'خلف',
  'في',
  'من',
]);

/** True when `name` (already normalized) appears in `text` (already normalized) as whole words. */
export function containsWords(text: string, name: string): boolean {
  if (!name) return false;
  return ` ${text} `.includes(` ${name} `);
}
