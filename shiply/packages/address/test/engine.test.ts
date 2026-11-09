import { test } from 'vitest';
import { assert } from 'vitest';
import { buildGazetteer } from '../src/gazetteer';
import { parseAddress } from '../src/engine';
import { SEED_PLACES } from '../src/seed-places';

// The plain place list, without names taught on this machine.
const g = buildGazetteer(SEED_PLACES);
const parse = (s: string) => parseAddress(s, g);
const pathOf = (s: string) => parse(s).path.map((p) => p.id);

test('the place list is consistent', () => {
  assert.ok(g.byId.size > 200);
});

test('Arabic address with building, street, landmark and neighbourhood', () => {
  const r = parse('عمارة 12 شارع 9 بجوار مسجد الفتح المعادي الجديدة القاهرة');
  assert.equal(r.status, 'sure');
  assert.deepEqual(r.path.map((p) => p.id), ['cairo', 'maadi', 'new-maadi']);
  assert.equal(r.parts.building, '12');
  assert.equal(r.parts.street, 'شارع 9');
  assert.equal(r.parts.landmark, 'مسجد الفتح');
});

test('the same address in English', () => {
  const r = parse('bldg 12 st 9 near el fath mosque new maadi');
  assert.equal(r.area?.id, 'new-maadi');
  assert.equal(r.parts.building, '12');
  assert.equal(r.parts.landmark, 'el fath mosque');
});

test('Franco spelling, floor, apartment and phone', () => {
  const r = parse('ma3adi degla, street 233, floor 3 apt 5, 01012345678');
  assert.equal(r.area?.id, 'degla');
  assert.equal(r.parts.floor, '3');
  assert.equal(r.parts.apartment, '5');
  assert.equal(r.parts.phone, '01012345678');
});

test('Franco settlement name', () => {
  assert.deepEqual(pathOf('el tagamo3 el 5ames, banafseg 5 villa 12'), ['cairo', 'new-cairo', 'fifth-settlement', 'banafseg']);
});

test('a known street places the address in its district', () => {
  const r = parse('15 عباس العقاد الدور الخامس شقة 10');
  assert.equal(r.area?.id, 'nasr-city');
  assert.equal(r.parts.floor, 'الخامس');
});

test('a typo in the area name is still found, as likely', () => {
  const r = parse('zamalk');
  assert.equal(r.area?.id, 'zamalek');
  assert.equal(r.status, 'likely');
});

test('different spellings of Mohandessin', () => {
  for (const s of ['mohandessin', 'mohandseen', 'el mohandeseen', 'المهندسين', 'mo7andseen']) {
    assert.equal(parse(s).area?.id, 'mohandessin', s);
  }
});

test('a shared name alone is never sure', () => {
  const r = parse('الحي السابع');
  assert.equal(r.status, 'unsure');
  assert.ok(r.reasons[0].includes('Nasr City') && r.reasons[0].includes('6th of October'));
  assert.equal(parse('الياسمين').status, 'likely');
});

test('a Nasr City street with its district number', () => {
  assert.deepEqual(pathOf('ahmed el zomor el hay el tamen'), ['cairo', 'nasr-city', 'nasr-city-hay-8']);
  assert.equal(parse('ahmed el zomor el hay el tamen').status, 'sure');
});

test('a shared name with its city is placed', () => {
  assert.deepEqual(pathOf('الحي السابع مدينة نصر'), ['cairo', 'nasr-city', 'nasr-city-hay-7']);
  assert.deepEqual(pathOf('الحي السابع اكتوبر'), ['giza', 'october', 'october-hay-7']);
});

test('two neighbourhoods of one district give the district', () => {
  const r = parse('شارع فيصل محطة الطالبية');
  assert.equal(r.status, 'sure');
  assert.equal(r.area?.id, 'haram');
});

test('two unrelated areas are unsure', () => {
  assert.equal(parse('Maadi Mohandessin').status, 'unsure');
});

test('a wrong governorate does not beat the area', () => {
  const r = parse('Maadi, Giza');
  assert.equal(r.area?.id, 'maadi');
  assert.ok(r.reasons.some((x) => x.includes('Maadi is in Cairo')));
});

test('outside Greater Cairo', () => {
  assert.equal(parse('Alexandria smouha 14 st').status, 'outside');
  assert.equal(parse('المنصورة شارع الجمهورية').status, 'outside');
});

test('governorate only', () => {
  assert.equal(parse('شارع 15 القاهرة').status, 'partial');
});

test('a landmark alone gives its area', () => {
  assert.equal(parse('بجوار سيتي ستارز').area?.id, 'nasr-city');
  assert.equal(parse('near mall of arabia').area?.id, 'october');
});

test('unknown words are listed', () => {
  const r = parse('some random text');
  assert.equal(r.status, 'not_found');
  assert.deepEqual(r.unknownWords, ['some', 'random', 'text']);
});

test('a taught name places addresses', () => {
  const taught = buildGazetteer(SEED_PLACES.map((p) => (p.id === 'maadi' ? { ...p, names: [...(p.names ?? []), 'kozzika maadi side'] } : p)));
  assert.equal(parseAddress('شارع 4 kozzika maadi side', taught).area?.id, 'maadi');
});

test('Hadayek: alone it lists every option, with a street it is decided', () => {
  const alone = parse('haday2');
  assert.equal(alone.status, 'unsure');
  assert.ok(alone.reasons[0].startsWith('6 areas fit'));
  const r = parse('masr wel sodan haday2');
  assert.equal(r.status, 'sure');
  assert.equal(r.area?.id, 'hadayek-el-kobba');
  assert.equal(r.parts.street, 'masr wel sodan');
});

test('a pasted numbered list with commas is read one address per line', async () => {
  const { extractAddresses } = await import('../src/bulk');
  const { addresses } = extractAddresses('1. Behind the bank, Nasr City, Cairo\n2. Near the station, Tanta, Gharbia');
  assert.deepEqual(addresses, ['Behind the bank, Nasr City, Cairo', 'Near the station, Tanta, Gharbia']);
  const csv = extractAddresses('Name,Shipping Address1,Shipping City\nAli,12 st 9,Maadi');
  assert.deepEqual(csv.addresses, ['12 st 9, Maadi']);
});

test('commas end a landmark, and everyday words are not read as places', () => {
  const r = parse('Around the corner from the high school, Damanhour, Beheira');
  assert.equal(r.status, 'outside');
  assert.equal(parse('Near the automatic bakery, El Arish, North Sinai').status, 'outside');
  assert.equal(parse('Behind the police station, Faisal, Giza').parts.landmark, 'police station');
});

test('a street named after a place is not that place', () => {
  assert.equal(parse('Port Said Street').status, 'unsure');
  assert.equal(parse('Port Said Street').path[0].id, 'cairo');
  assert.equal(parse('Gesr El Suez Street').path[0].id, 'cairo');
  assert.equal(parse('El Manial Street').status, 'likely');
});

test('a street that runs through several districts lists them', () => {
  const r = parse('Salah Salem Street');
  assert.equal(r.status, 'unsure');
  assert.ok(r.reasons[0].startsWith('3 areas fit'));
  assert.equal(parse('Salah Salem Street, Nasr City').area?.id, 'nasr-city');
});

test('taught names are used, inactive places are not', () => {
  const taught = buildGazetteer(SEED_PLACES, [{ name: 'fumfum', placeId: 'maadi' }]);
  assert.equal(parseAddress('fumfum street 3', taught).area?.id, 'maadi');
  const noMaadi = buildGazetteer(SEED_PLACES.map((p) => (p.id === 'zamalek' ? { ...p, active: false } : p)));
  assert.notEqual(parseAddress('zamalek', noMaadi).area?.id, 'zamalek');
});
