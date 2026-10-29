import { normalizeAddressText } from '@shiplynow/shared';
import type { Db } from '../client';

// Names people use for places that the district map (geoBoundaries) and OpenStreetMap do not
// carry, or carry in one language only. Each name is added to the district that holds the
// place, so the engine finds the district from it; the district's own shape decides the zone.
// Only places that sit wholly inside one district are listed (a name shared by two districts,
// such as El Narges, is left out on purpose).

interface DictionaryEntry {
  /** The district's English name and its governorate, as in geo_areas */
  district: string;
  governorate: string;
  names: string[];
}

export const AREA_DICTIONARY: readonly DictionaryEntry[] = [
  {
    district: 'New Cairo',
    governorate: 'Cairo',
    names: [
      'rehab',
      'el rehab',
      'al rehab',
      'rehab city',
      'الرحاب',
      'مدينه الرحاب',
      'madinaty',
      'madinty',
      'مدينتي',
      'katameya',
      'kattameya',
      'qattamiya',
      'katameya heights',
      'القطاميه',
      'قطاميه',
      '5th settlement',
      'the 5th settlement',
      'fifth settlement',
      'el tagamoa el khames',
      'tagamoa el khames',
      'التجمع الخامس',
      'تجمع خامس',
      'first settlement',
      'التجمع الاول',
      'third settlement',
      'التجمع الثالث',
      'banafseg',
      'el banafseg',
      'البنفسج',
      'lotus',
      'el lotus',
      'اللوتس',
      'golden square',
      'الجولدن سكوير',
      'south investors',
      'north investors',
      'المستثمرين الجنوبيه',
      'المستثمرين الشماليه',
      '90th street',
      'south 90th',
      'north 90th',
      'شارع التسعين',
      'التسعين الجنوبي',
      'التسعين الشمالي',
      'mivida',
      'ميفيدا',
      'hyde park',
      'هايد بارك',
      'el andalus',
      'الاندلس',
      'gharb el golf',
      'غرب الجولف',
    ],
  },
  {
    district: 'Maadi',
    governorate: 'Cairo',
    names: [
      'degla',
      'dejla',
      'degla maadi',
      'دجله',
      'دجله المعادي',
      'sarayat el maadi',
      'sarayat',
      'سرايات المعادي',
      'zahraa el maadi',
      'zahraa maadi',
      'زهراء المعادي',
      'new maadi',
      'المعادي الجديده',
      'maadi el sarayat',
      'cornish el maadi',
      'كورنيش المعادي',
    ],
  },
  {
    district: 'Heliopolis',
    governorate: 'Cairo',
    names: [
      'ard el golf',
      'ard al golf',
      'ارض الجولف',
      'roxy',
      'روكسي',
      'merghany',
      'الميرغني',
      'almaza',
      'الماظه',
      'el korba',
      'الكوربه',
    ],
  },
  {
    district: 'El Nozha',
    governorate: 'Cairo',
    names: [
      'masaken sheraton',
      'مساكن شيراتون',
      'sheraton heliopolis',
      'نزهه الجديده',
      'el nozha el gedida',
      'new nozha',
    ],
  },
  {
    district: 'Nasr City',
    governorate: 'Cairo',
    names: [
      'abbas el akkad',
      'abbas akkad',
      'عباس العقاد',
      'makram ebeid',
      'مكرم عبيد',
      'city stars',
      'سيتي ستارز',
      'el hay el asher',
      'الحي العاشر',
      'zahraa nasr city',
    ],
  },
  {
    district: 'Sheikh Zayed',
    governorate: 'Giza',
    names: ['beverly hills', 'بيفرلي هيلز', 'zayed 2000', 'زايد 2000', 'el sheikh zayed city'],
  },
  {
    district: '6th of October',
    governorate: 'Giza',
    names: [
      'hadayek october',
      'hadayek el october',
      'حدائق اكتوبر',
      'حدائق 6 اكتوبر',
      'el hosary',
      'الحصري',
      'dreamland',
      'دريم لاند',
      '6th of october city',
      'مدينه 6 اكتوبر',
    ],
  },
  {
    district: 'El Haram',
    governorate: 'Giza',
    names: [
      'hadayek el ahram',
      'hadayek al ahram',
      'حدائق الاهرام',
      'el mariouteya',
      'المريوطيه',
      'faisal street',
      'شارع فيصل',
      'el talbia',
      'الطالبيه',
    ],
  },
  {
    district: 'Agouza',
    governorate: 'Giza',
    names: ['mohandessin', 'mohandiseen', 'el mohandeseen', 'المهندسين', 'lebanon square'],
  },
];

/**
 * Adds the dictionary's names to their districts (all rows with that name in that governorate),
 * keeping every name already there. Safe on every start: a name already present changes
 * nothing. Returns how many districts gained names.
 */
export async function applyAreaDictionary(db: Db) {
  let updated = 0;
  for (const entry of AREA_DICTIONARY) {
    const names = [...new Set(entry.names.map(normalizeAddressText))].filter((n) => n.length >= 2);
    const rows = await db.$queryRaw<{ id: string; aliases: string[] }[]>`
      SELECT a.id, a.aliases FROM geo_areas a JOIN geo_areas g ON g.id = a.parent_id
      WHERE a.level = 2 AND a.name_en = ${entry.district} AND g.name_en = ${entry.governorate}`;
    for (const row of rows) {
      const missing = names.filter((n) => !row.aliases.includes(n));
      if (missing.length === 0) continue;
      await db.geoArea.update({
        where: { id: row.id },
        data: { aliases: [...row.aliases, ...missing] },
      });
      updated++;
    }
  }
  return { updated };
}
