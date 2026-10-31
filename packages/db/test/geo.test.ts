import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  applyAreaDictionary,
  forgetAreaNames,
  learnFromPoint,
  loadBaseAreas,
  resolveByAreas,
  upsertArea,
} from '../src/geo';
import { createFixture, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;

/** A zone of the fixture store drawn as the given district grown by `grow` degrees. */
async function zoneAround(code: string, nameEn: string, grow: number, darkStoreId = f.store.id) {
  const zone = await prisma.zone.create({
    data: { darkStoreId, code, nameEn: code, nameAr: code, governorateId: 1 },
  });
  await prisma.$executeRaw`
    UPDATE zones SET area = (SELECT ST_Multi(ST_Buffer(geom, ${grow})) FROM geo_areas
      WHERE name_en = ${nameEn} AND level = 2 LIMIT 1)
    WHERE id = ${zone.id}`;
  return zone;
}

beforeAll(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
  forgetAreaNames();
  f = await createFixture();
  await loadBaseAreas(prisma);
});

afterAll(() => prisma.$disconnect());

describe('area engine', () => {
  it('loads Greater Cairo with each district under its governorate', async () => {
    const maadi = await prisma.geoArea.findFirstOrThrow({
      where: { nameEn: 'Maadi' },
      include: { parent: true },
    });
    expect(maadi.level).toBe(2);
    expect(maadi.parent?.nameEn).toBe('Cairo');
    expect(maadi.aliases).toContain('المعادي');
    // Loading again changes nothing.
    const before = await prisma.geoArea.count();
    await loadBaseAreas(prisma);
    expect(await prisma.geoArea.count()).toBe(before);
  });

  it('decides the zone from the district name, in English or Arabic', async () => {
    const zone = await zoneAround('MAA-ALL', 'Maadi', 0.01);
    for (const address of ['Villa 4, Road 9, Maadi, Cairo', 'شارع ٩، المعادي، القاهرة']) {
      const r = await resolveByAreas(prisma, address);
      expect(r).toMatchObject({ status: 'zone', zoneId: zone.id, darkStoreId: f.store.id });
      expect(r.chain.map((c) => c.nameEn)).toEqual(['Cairo', 'Maadi']);
    }
  });

  it('says outside without any lookup when the district is far from every zone', async () => {
    await zoneAround('MAA-ALL', 'Maadi', 0.01);
    expect(await resolveByAreas(prisma, '12 Street 5, Sheikh Zayed, Giza')).toMatchObject({
      status: 'outside',
    });
  });

  it('is unsure when the area is split between zones, and when nothing is named', async () => {
    // A zone covering only part of Nasr City.
    const zone = await prisma.zone.create({
      data: { darkStoreId: f.store.id, code: 'PART', nameEn: 'x', nameAr: 'x', governorateId: 1 },
    });
    await prisma.$executeRaw`
      UPDATE zones SET area = (SELECT ST_Multi(ST_Buffer(ST_PointOnSurface(geom), 0.01))
        FROM geo_areas WHERE name_en = 'Nasr City' LIMIT 1) WHERE id = ${zone.id}`;
    expect(await resolveByAreas(prisma, 'Abbas El Akkad, Nasr City')).toMatchObject({
      status: 'unsure',
      reason: 'area_spans_zones',
    });
    expect(await resolveByAreas(prisma, 'Building 7, floor 3')).toMatchObject({
      status: 'unsure',
      reason: 'no_area_named',
    });
  });

  it('trusts a repeated street name only inside the area the address names', async () => {
    const square = (lng: number, lat: number) => ({
      type: 'Polygon',
      coordinates: [
        [
          [lng, lat],
          [lng + 0.002, lat],
          [lng + 0.002, lat + 0.002],
          [lng, lat + 0.002],
          [lng, lat],
        ],
      ],
    });
    const [maadi] = await prisma.$queryRaw<{ lng: number; lat: number }[]>`
      SELECT ST_X(ST_PointOnSurface(geom)) AS lng, ST_Y(ST_PointOnSurface(geom)) AS lat
      FROM geo_areas WHERE name_en = 'Maadi'`;
    const [dokki] = await prisma.$queryRaw<{ lng: number; lat: number }[]>`
      SELECT ST_X(ST_PointOnSurface(geom)) AS lng, ST_Y(ST_PointOnSurface(geom)) AS lat
      FROM geo_areas WHERE name_en = 'Dokki'`;
    for (const [ref, p] of [
      ['t:1', maadi!],
      ['t:2', dokki!],
    ] as const)
      await upsertArea(prisma, {
        ref,
        level: 5,
        nameEn: 'Tahrir Street',
        nameAr: 'شارع التحرير',
        aliases: ['tahrir'],
        source: 'test',
        geometry: square(p.lng, p.lat),
      });
    forgetAreaNames();
    const zone = await zoneAround('DOK-ALL', 'Dokki', 0.01);
    expect(await resolveByAreas(prisma, '5 Tahrir, Dokki, Giza')).toMatchObject({
      status: 'zone',
      zoneId: zone.id,
    });
    const giza = await resolveByAreas(prisma, 'Mosadak street, Dokki, Giza');
    expect(giza.chain.map((c) => c.nameEn)).toEqual(['Giza', 'Dokki']);
    const r = await resolveByAreas(prisma, '5 Tahrir, Dokki');
    expect(r.chain.at(-1)?.nameEn).toBe('Tahrir Street');
    // Without the district, "Tahrir" alone is not trusted.
    expect((await resolveByAreas(prisma, '5 Tahrir')).status).toBe('unsure');
  });

  it('learns the words Google placed that it did not know', async () => {
    const [p] = await prisma.$queryRaw<{ lng: number; lat: number }[]>`
      SELECT ST_X(ST_PointOnSurface(geom)) AS lng, ST_Y(ST_PointOnSurface(geom)) AS lat
      FROM geo_areas WHERE name_en = 'Maadi'`;
    const learned = await learnFromPoint(prisma, 'Building 12, Degla Gardens street', {
      latitude: p!.lat,
      longitude: p!.lng,
    });
    expect(learned?.phrase).toBe('degla gardens');
    await learnFromPoint(prisma, 'Degla Gardens street 7', { latitude: p!.lat, longitude: p!.lng });
    const s = await prisma.geoSuggestion.findFirstOrThrow({ include: { area: true } });
    expect(s).toMatchObject({ phrase: 'degla gardens', seen: 2, status: 'pending' });
    expect(s.area.nameEn).toBe('Maadi');
  });

  it('reads names spelled loosely: El Maady, معادي, Mohandiseen', async () => {
    const zone = await zoneAround('MAA-ALL', 'Maadi', 0.01);
    for (const address of ['14 Road 233, El Maady', 'شارع ٢٣٣ معادي', 'Maady, Cairo'])
      expect(await resolveByAreas(prisma, address)).toMatchObject({
        status: 'zone',
        zoneId: zone.id,
      });
  });

  it('knows the names people use for places the map lacks (Rehab, Degla, Madinaty)', async () => {
    expect((await resolveByAreas(prisma, 'Rehab City, group 96')).chain).toEqual([]);
    expect(await applyAreaDictionary(prisma)).toMatchObject({ updated: expect.any(Number) });
    // Running it again adds nothing.
    expect(await applyAreaDictionary(prisma)).toEqual({ updated: 0 });
    forgetAreaNames();
    for (const [address, district] of [
      ['Rehab City, group 96, building 12', 'New Cairo'],
      ['مدينتي B6', 'New Cairo'],
      ['Street 200, Degla', 'Maadi'],
      ['زهراء المعادي عماره 5', 'Maadi'],
      ['Beverly Hills compound', 'Sheikh Zayed'],
      ['التجمع الخامس الحي الاول', 'New Cairo'],
    ] as const) {
      const r = await resolveByAreas(prisma, address);
      expect(r.chain.map((c) => c.nameEn)).toContain(district);
    }
    // "الدور الخامس" (fifth floor) is not the Fifth Settlement.
    expect((await resolveByAreas(prisma, 'عماره 3 الدور الخامس')).chain).toEqual([]);
  });

  it('never places an address in another governorate on a Cairo street with the same name', async () => {
    const [maadi] = await prisma.$queryRaw<{ lng: number; lat: number }[]>`
      SELECT ST_X(ST_PointOnSurface(geom)) AS lng, ST_Y(ST_PointOnSurface(geom)) AS lat
      FROM geo_areas WHERE name_en = 'Maadi'`;
    await upsertArea(prisma, {
      ref: 't:gomhoreya',
      level: 5,
      nameEn: 'El Gomhoreya Street',
      nameAr: 'شارع الجمهوريه',
      aliases: ['الجمهوريه', 'gomhoreya'],
      source: 'test',
      geometry: { type: 'Point', coordinates: [maadi!.lng, maadi!.lat] },
      bufferMeters: 150,
    });
    forgetAreaNames();
    await zoneAround('MAA-ALL', 'Maadi', 0.01);
    for (const address of [
      'سوهاج امتداد شارع الجمهوريه, سوهاج, Sohag',
      '12 Gomhoreya, Alexandria, Cairo',
      'المنصوره - الجمهوريه',
    ])
      expect(await resolveByAreas(prisma, address)).toMatchObject({ status: 'outside' });
    // A Cairo street named after a city stays ours, and a named district of ours wins.
    expect((await resolveByAreas(prisma, 'شارع بورسعيد, المعادي')).chain.at(-1)?.nameEn).toBe(
      'Maadi',
    );
    expect(
      (await resolveByAreas(prisma, 'طريق السويس, المعادي')).chain.map((c) => c.nameEn),
    ).toContain('Maadi');
  });
});
