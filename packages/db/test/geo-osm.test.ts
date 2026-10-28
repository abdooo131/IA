import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  forgetAreaNames,
  loadBaseAreas,
  type OsmElement,
  osmNames,
  placeAreas,
  resolveByAreas,
  saveDistrictStreets,
  saveOsmAreas,
} from '../src/geo';
import { createFixture, prisma, resetDatabase } from './helpers';

let maadi: { id: string; ref: string; lng: number; lat: number };

beforeEach(async () => {
  await resetDatabase();
  forgetAreaNames();
  await createFixture();
  await loadBaseAreas(prisma);
  const [m] = await prisma.$queryRaw<{ id: string; ref: string; lng: number; lat: number }[]>`
    SELECT id, ref, ST_X(ST_PointOnSurface(geom)) AS lng, ST_Y(ST_PointOnSurface(geom)) AS lat
    FROM geo_areas WHERE name_en = 'Maadi'`;
  maadi = m!;
});

afterAll(() => prisma.$disconnect());

/** A small square (about 200 m) starting at the point, as OpenStreetMap points. */
const square = (lng: number, lat: number, d = 0.002) => [
  { lon: lng, lat },
  { lon: lng + d, lat },
  { lon: lng + d, lat: lat + d },
  { lon: lng, lat: lat + d },
  { lon: lng, lat },
];

describe('OpenStreetMap import', () => {
  it('reads Arabic and English names and every alternative', () => {
    expect(
      osmNames({ name: 'دجلة', 'name:en': 'Degla', alt_name: 'Degla Maadi;Maadi Degla' }),
    ).toEqual({
      nameEn: 'Degla',
      nameAr: 'دجلة',
      aliases: ['دجلة', 'Degla Maadi', 'Maadi Degla'],
    });
    expect(osmNames({ name: 'Rehab City' })).toMatchObject({
      nameEn: 'Rehab City',
      nameAr: 'Rehab City',
    });
  });

  it('turns neighbourhoods, compounds and points into areas under their district', async () => {
    const pts = square(maadi.lng, maadi.lat);
    const elements: OsmElement[] = [
      {
        // An outline in two pieces, as relations come.
        type: 'relation',
        id: 1,
        tags: { boundary: 'administrative', admin_level: '9', name: 'دجلة', 'name:en': 'Degla' },
        members: [
          { type: 'way', role: 'outer', geometry: pts.slice(0, 3) },
          { type: 'way', role: 'outer', geometry: pts.slice(2) },
        ],
      },
      {
        type: 'way',
        id: 2,
        tags: { landuse: 'residential', name: 'Degla Palms' },
        geometry: square(maadi.lng + 0.0005, maadi.lat + 0.0005, 0.0008),
      },
      {
        type: 'node',
        id: 3,
        tags: { place: 'neighbourhood', name: 'Sarayat' },
        lat: maadi.lat + 0.01,
        lon: maadi.lng,
      },
      { type: 'way', id: 4, tags: { place: 'suburb', name: 'Open' }, geometry: pts.slice(0, 3) },
      { type: 'node', id: 5, tags: { place: 'neighbourhood' }, lat: maadi.lat, lon: maadi.lng },
    ];
    const areas = placeAreas(elements);
    expect(areas.map((a) => [a.ref, a.level])).toEqual([
      ['osm:relation/1', 3],
      ['osm:way/2', 4],
      ['osm:node/3', 3],
    ]);
    expect(await saveOsmAreas(prisma, areas)).toEqual({ found: 3, saved: 3 });
    const palms = await prisma.geoArea.findUniqueOrThrow({
      where: { ref: 'osm:way/2' },
      include: { parent: { include: { parent: true } } },
    });
    expect(palms.parent?.nameEn).toBe('Degla');
    expect(palms.parent?.parent?.nameEn).toBe('Maadi');

    const r = await resolveByAreas(prisma, 'Villa 3, Degla Palms, Maadi');
    expect(r.chain.map((c) => c.nameEn)).toEqual(['Cairo', 'Maadi', 'Degla', 'Degla Palms']);
    // Running the import again only refreshes the same rows.
    await saveOsmAreas(prisma, areas);
    expect(await prisma.geoArea.count({ where: { source: 'osm' } })).toBe(3);
  });

  it('keeps one strip per street name, trimmed to the district', async () => {
    const elements: OsmElement[] = [
      {
        type: 'way',
        id: 10,
        tags: { highway: 'residential', name: 'شارع ٩', 'name:en': 'Road 9' },
        geometry: [
          { lon: maadi.lng, lat: maadi.lat },
          { lon: maadi.lng + 0.003, lat: maadi.lat },
        ],
      },
      {
        type: 'way',
        id: 11,
        tags: { highway: 'residential', name: 'شارع ٩' },
        geometry: [
          { lon: maadi.lng + 0.003, lat: maadi.lat },
          { lon: maadi.lng + 0.006, lat: maadi.lat },
        ],
      },
      {
        // Far outside Maadi: trimmed away entirely.
        type: 'way',
        id: 12,
        tags: { highway: 'primary', name: 'Faraway Road' },
        geometry: [
          { lon: 30.9, lat: 30.3 },
          { lon: 30.91, lat: 30.3 },
        ],
      },
    ];
    expect(await saveDistrictStreets(prisma, maadi, elements)).toEqual({ found: 2, saved: 1 });
    const street = await prisma.geoArea.findFirstOrThrow({
      where: { level: 5 },
      include: { parent: true },
    });
    expect(street).toMatchObject({ nameEn: 'Road 9', nameAr: 'شارع ٩' });
    expect(street.parent?.nameEn).toBe('Maadi');
  });
});
