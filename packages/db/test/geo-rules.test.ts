import { describe, expect, it } from 'vitest';
import { normalizeAddressText } from '@shiplynow/shared';
import { buildAreaIndex, namesOtherGovernorate, readAddressWith } from '../src/geo/engine';

// The matching rules of docs/ZONES.md section 3, on a small made up map (no database).
const row = (
  id: string,
  level: number,
  parentId: string | null,
  nameEn: string,
  nameAr: string,
  extra: string[] = [],
) => ({
  id,
  level,
  parentId,
  nameEn,
  nameAr,
  aliases: [nameEn, nameAr, ...extra].map(normalizeAddressText),
});

const index = buildAreaIndex([
  row('cairo', 1, null, 'Cairo', 'القاهره'),
  row('giza', 1, null, 'Giza', 'الجيزه'),
  row('maadi', 2, 'cairo', 'Maadi', 'المعادي'),
  row('newcairo', 2, 'cairo', 'New Cairo', 'القاهره الجديده'),
  row('october', 2, 'giza', '6th of October', 'السادس من اكتوبر', ['october']),
  row('shorouk', 2, 'cairo', 'El Shorouk', 'الشروق', ['sherouk']),
  row('heliopolis', 2, 'cairo', 'Heliopolis', 'مصر الجديده'),
  row('degla', 3, 'maadi', 'Degla', 'دجله'),
  row('n8', 3, 'newcairo', 'Neighbourhood 8', 'الحي الثامن'),
  row('palm-nc', 4, 'newcairo', 'Palm Hills', 'بالم هيلز'),
  row('palm-oct', 4, 'october', 'Palm Hills', 'بالم هيلز'),
  row('nasr-gardens', 3, 'newcairo', 'El Nasr Gardens', 'حدائق النصر'),
  row('nasr', 3, 'maadi', 'El Nasr', 'النصر'),
  row('hassan', 5, 'maadi', 'Hassan Street', 'شارع حسن', ['حسن']),
  row('tahrir-maadi', 5, 'degla', 'Tahrir Street', 'شارع التحرير', ['tahrir']),
  row('road9', 5, 'maadi', 'Street 9', 'شارع 9'),
  row('suez-road', 5, 'heliopolis', 'Gesr El Suez', 'جسر السويس'),
]);

const read = (text: string) => readAddressWith(index, text);
const ids = (r: ReturnType<typeof read>) => (r.status === 'area' ? r.areas.map((a) => a.id) : []);

describe('area engine rules', () => {
  it('never lets the governorate alone back a street or a neighbourhood', () => {
    expect(read('5 Tahrir, Cairo')).toMatchObject({
      status: 'unsure',
      reason: 'street_without_area',
    });
    expect(read('Neighbourhood 8, Cairo')).toMatchObject({
      status: 'unsure',
      reason: 'generic_without_parent',
    });
    expect(read('Cairo')).toMatchObject({ status: 'unsure', reason: 'too_coarse' });
  });

  it('lets a named district win over anything outside it; streets only narrow inside it', () => {
    // Degla is in Maadi; the address names New Cairo, so New Cairo it is.
    expect(ids(read('Villa 3, Degla, New Cairo'))).toEqual(['newcairo']);
    // Inside Maadi, a street narrows to itself.
    expect(ids(read('12 Tahrir, Degla, Maadi'))).toEqual(['tahrir-maadi']);
    // A street never picks the district.
    expect(read('12 Tahrir').status).toBe('unsure');
  });

  it('matches whole words only, and the longest name wins', () => {
    expect(ids(read('شارع حسنين، المعادي'))).toEqual(['maadi']);
    expect(ids(read('Villa 2, El Nasr Gardens, New Cairo'))).toEqual(['nasr-gardens']);
    expect(ids(read('El Nasr, Maadi'))).toEqual(['nasr']);
  });

  it('asks a generic or numbered name for its parent', () => {
    expect(read('Building 4, Neighbourhood 8')).toMatchObject({
      status: 'unsure',
      reason: 'generic_without_parent',
    });
    expect(ids(read('Building 4, Neighbourhood 8, New Cairo'))).toEqual(['n8']);
    // "Street 9" alone says nothing; inside Maadi it narrows.
    expect(read('Street 9').status).toBe('unsure');
    expect(ids(read('Street 9, Maadi'))).toEqual(['road9']);
  });

  it('never picks one of several places sharing a name when no parent is named', () => {
    expect(read('Palm Hills villa 20')).toMatchObject({
      status: 'unsure',
      reason: 'ambiguous_name',
    });
    expect(ids(read('Palm Hills villa 20, October'))).toEqual(['palm-oct']);
    // Two districts named: both are returned, the caller decides only if they agree.
    expect(ids(read('Maadi, Heliopolis')).sort()).toEqual(['heliopolis', 'maadi']);
  });

  it('splits numbers glued to names', () => {
    expect(normalizeAddressText('sherouk1 building 4')).toBe('sherouk 1 building 4');
    expect(normalizeAddressText('التجمع5')).toBe('التجمع 5');
    expect(normalizeAddressText('90th street')).toBe('90th street');
    expect(ids(read('sherouk1 building 4'))).toEqual(['shorouk']);
  });

  it('reads جسر السويس as a street, not the Suez governorate', () => {
    expect(namesOtherGovernorate(normalizeAddressText('جسر السويس'))).toBe(false);
    expect(namesOtherGovernorate(normalizeAddressText('السويس'))).toBe(true);
    expect(ids(read('15 جسر السويس، مصر الجديده'))).toEqual(['suez-road']);
    expect(read('حي الاربعين، السويس')).toMatchObject({ status: 'outside' });
  });
});
