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

/**
 * A looser spelling of normalized text, for matching names people write in many ways: the
 * Arabic article on longer words and the Latin "el", "al" and "the" are dropped, and common
 * Latin transliteration differences are folded (ee/i, oo/ou/u, y/i, q/k, doubled letters).
 * "El Maady" and "maadi", "المعادي" and "معادي" fold to the same text.
 */
export function foldPlaceText(normalized: string): string {
  return normalized
    .split(' ')
    .filter((w) => w && !['el', 'al', 'the'].includes(w))
    .map((w) => {
      if (/^ال/.test(w) && w.length >= 4) return w.slice(2);
      if (!/^[a-z0-9]+$/.test(w)) return w;
      return w
        .replace(/ee/g, 'i')
        .replace(/oo|ou/g, 'u')
        .replace(/y/g, 'i')
        .replace(/q/g, 'k')
        .replace(/([a-z])\1+/g, '$1');
    })
    .join(' ');
}

/**
 * Egypt's governorates outside Greater Cairo, with the names and main cities people write for
 * them (normalized). An address naming one of these is outside the area we serve.
 */
export const OTHER_GOVERNORATE_NAMES: readonly string[] = [
  'alexandria',
  'alex',
  'الاسكندريه',
  'اسكندريه',
  'اسكندرية',
  'الاسكندرية',
  'dakahlia',
  'el dakahlia',
  'الدقهليه',
  'mansoura',
  'el mansoura',
  'المنصوره',
  'منصوره',
  'sharqia',
  'al sharqia',
  'el sharkia',
  'sharkia',
  'الشرقيه',
  'zagazig',
  'الزقازيق',
  'gharbia',
  'el gharbia',
  'الغربيه',
  'tanta',
  'طنطا',
  'el mahalla',
  'المحله',
  'المحله الكبري',
  'monufia',
  'menoufia',
  'el menoufia',
  'المنوفيه',
  'shebin el kom',
  'شبين الكوم',
  'beheira',
  'el beheira',
  'البحيره',
  'damanhour',
  'دمنهور',
  'kafr el dawar',
  'كفر الدوار',
  'kafr el sheikh',
  'kafr el-sheikh',
  'كفر الشيخ',
  'damietta',
  'دمياط',
  'port said',
  'بورسعيد',
  'بور سعيد',
  'ismailia',
  'الاسماعيليه',
  'suez',
  'السويس',
  'fayoum',
  'faiyum',
  'الفيوم',
  'beni suef',
  'bani suef',
  'بني سويف',
  'minya',
  'el minya',
  'المنيا',
  'asyut',
  'assiut',
  'asiut',
  'اسيوط',
  'sohag',
  'سوهاج',
  'qena',
  'قنا',
  'luxor',
  'الاقصر',
  'aswan',
  'اسوان',
  'red sea',
  'البحر الاحمر',
  'hurghada',
  'الغردقه',
  'matrouh',
  'marsa matrouh',
  'مطروح',
  'مرسي مطروح',
  'north sinai',
  'شمال سيناء',
  'el arish',
  'العريش',
  'south sinai',
  'جنوب سيناء',
  'sharm el sheikh',
  'شرم الشيخ',
  'new valley',
  'الوادي الجديد',
].map(normalizeAddressText);

/** Words just before or after a place name that make it a street's name, not where it is. */
export const STREET_WORDS = new Set([
  'شارع',
  'ش',
  'طريق',
  'ميدان',
  'كوبري',
  'street',
  'st',
  'road',
  'rd',
  'square',
  'bridge',
]);
