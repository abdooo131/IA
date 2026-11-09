// Text cleaning. Every address and every place name goes through the same steps, so that
// "المعادى", "El Maady" and "ma3adi" all end up as the same key.

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** Franco Arabic digits and the Latin letters they usually stand for. */
const FRANCO: Record<string, string> = { '2': 'a', '3': 'a', '5': 'kh', '7': 'h', '8': 'gh' };

/**
 * Turns Franco digits inside Latin words into letters: "ma3adi" → "maaadi", "mo7andseen" →
 * "mohandseen", "3agouza" → "agouza". Ordinals such as "5th" and plain numbers stay as they are.
 */
function francoWord(word: string): string {
  if (!/^[a-z0-9]+$/.test(word)) return word;
  if (!/[a-z]/.test(word) || !/[23578]/.test(word)) return word;
  if (/^\d+(st|nd|rd|th)$/.test(word)) return word;
  if ((word.match(/[a-z]/g) ?? []).length < 2) return word;
  let out = '';
  for (let i = 0; i < word.length; i++) {
    const ch = word[i];
    const prev = word[i - 1] ?? '';
    const next = word[i + 1] ?? '';
    const isFranco = ch in FRANCO && !/\d/.test(prev) && !/\d/.test(next);
    const touchesLetter = /[a-z]/.test(prev) || /[a-z]/.test(next);
    if (isFranco && touchesLetter) {
      // A 3 or 2 at the start before a vowel is silent: "3agouza" → "agouza".
      if ((ch === '3' || ch === '2') && i === 0 && /[aeiou]/.test(next)) continue;
      out += FRANCO[ch];
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Lowercase, Latin digits, one form for each Arabic letter family, no diacritics, Franco
 * digits turned into letters, punctuation as spaces, numbers glued to names split apart.
 */
export function normalizeText(input: string): string {
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
  s = s.replace(/[^\p{L}\p{N}]+/gu, ' ');
  // "el3obour" → "el 3obour" so the article comes off before the Franco step.
  s = s.replace(/\b(el|al)(\d)/g, '$1 $2');
  s = s
    .split(' ')
    .map(francoWord)
    .join(' ');
  // Numbers glued to names are split ("sherouk1" → "sherouk 1", "التجمع5" → "التجمع 5").
  s = s.replace(/(\p{L})(\d)/gu, '$1 $2').replace(/(\d)(\p{Script=Arabic})/gu, '$1 $2');
  return s.trim().replace(/\s+/g, ' ');
}

/**
 * The matching key of one normalized word. Drops the Arabic article (and a joined و ب ف ل ك
 * before it) and the Latin "el", "al", "the"; folds Latin spelling differences (ee/i, oo/ou/u,
 * y/i, q/k, ph/f, doubled letters). Returns '' for words that carry no meaning on their own.
 */
export function foldWord(word: string): string {
  if (['el', 'al', 'the', 'ال'].includes(word)) return '';
  if (/\p{Script=Arabic}/u.test(word)) {
    let w = word;
    if (w.length >= 5 && /^[وبفك]ال/.test(w)) w = w.slice(1);
    if (w.length >= 4 && /^لل/.test(w)) w = 'ال' + w.slice(2);
    if (w.length >= 4 && /^ال/.test(w)) w = w.slice(2);
    return w;
  }
  if (!/^[a-z0-9]+$/.test(word)) return word;
  return word
    .replace(/ee/g, 'i')
    .replace(/oo|ou/g, 'u')
    .replace(/y/g, 'i')
    .replace(/q/g, 'k')
    .replace(/ph/g, 'f')
    .replace(/([a-z])\1+/g, '$1');
}

/** The matching key of a whole name or phrase. */
export function foldText(text: string): string {
  return normalizeText(text).split(' ').map(foldWord).filter(Boolean).join(' ');
}

/**
 * A looser key for Latin text: the folded words without vowels ("mohandessin", "mohandseen"
 * and "mohandeseen" all give "mhndsn"). Null when it would be too short to trust.
 */
export function skeleton(folded: string): string | null {
  if (!/^[a-z0-9 ]+$/.test(folded)) return null;
  const s = folded
    .split(' ')
    .map((w) => (/^\d+$/.test(w) ? w : w.replace(/[aeiou]/g, '')))
    .filter(Boolean)
    .join(' ');
  return s.replace(/ /g, '').length >= 4 ? s : null;
}

/** Edit distance between two short strings, stopping early once it passes `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}
