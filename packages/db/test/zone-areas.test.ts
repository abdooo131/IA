import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  applyAreaDictionary,
  assignArea,
  assignAreasFromOutlines,
  assignAreasInShape,
  cleanUpAreas,
  excludeArea,
  forgetAreaNames,
  listAreasForMap,
  listAreasToReview,
  loadBaseAreas,
  prepareAreaMap,
  readAddress,
  recordDeliveredPoint,
  resolveDelivery,
  searchServedAreas,
  unassignArea,
  upsertArea,
} from '../src/geo';
import { zonesContaining } from '../src/zones';
import { createFixture, prisma, resetDatabase } from './helpers';

// Zones built from areas (docs/ZONES.md): assignment, the one delivery decision, the move from
// drawn outlines, the clean up and the points learned from deliveries. The map here is the
// development one (governorates and districts) plus small made up neighbourhoods.

let f: Awaited<ReturnType<typeof createFixture>>;
let actor: string;

const district = async (nameEn: string) =>
  (
    await prisma.$queryRaw<{ id: string; lng: number; lat: number }[]>`
      SELECT id, ST_X(ST_PointOnSurface(geom)) AS lng, ST_Y(ST_PointOnSurface(geom)) AS lat
      FROM geo_areas WHERE name_en = ${nameEn} AND level = 2 AND is_active LIMIT 1`
  )[0]!;

const zoneOf = (darkStoreId: string, code: string) =>
  prisma.zone.create({
    data: { darkStoreId, code, nameEn: code, nameAr: code, governorateId: 1 },
  });

const square = (lng: number, lat: number, d = 0.004) => ({
  type: 'Polygon' as const,
  coordinates: [
    [
      [lng, lat],
      [lng + d, lat],
      [lng + d, lat + d],
      [lng, lat + d],
      [lng, lat],
    ],
  ],
});

/** A made up neighbourhood (level 3) of about 400 m inside a district, at its inner point. */
async function neighbourhood(ref: string, nameEn: string, nameAr: string, inside: string) {
  const d = await district(inside);
  const id = await upsertArea(prisma, {
    ref,
    level: 3,
    nameEn,
    nameAr,
    aliases: [],
    source: 'test',
    geometry: square(d.lng, d.lat),
  });
  forgetAreaNames();
  return { id: id!, lng: d.lng + 0.002, lat: d.lat + 0.002 };
}

const tx = <T>(fn: (t: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>) =>
  prisma.$transaction(fn, { timeout: 60_000 });

beforeEach(async () => {
  await resetDatabase();
  forgetAreaNames();
  f = await createFixture();
  actor = (
    await prisma.user.create({
      data: { email: 'a@t.eg', name: 'Admin', role: 'admin', passwordHash: 'x' },
    })
  ).id;
  await loadBaseAreas(prisma);
  await cleanUpAreas(prisma);
});

afterAll(() => prisma.$disconnect());

describe('assigning areas to zones', () => {
  it('serves a district, recomputes the zone polygon and audits every change', async () => {
    const zone = await zoneOf(f.store.id, 'MAA');
    const maadi = await district('Maadi');
    await tx((t) => assignArea(t, { areaId: maadi.id, zoneId: zone.id, actorUserId: actor }));
    expect(
      (await zonesContaining(prisma, { latitude: maadi.lat, longitude: maadi.lng }))[0],
    ).toMatchObject({
      id: zone.id,
    });
    // Assigning again changes nothing.
    expect(
      await tx((t) => assignArea(t, { areaId: maadi.id, zoneId: zone.id, actorUserId: actor })),
    ).toEqual({ changed: false, areaId: maadi.id });

    await tx((t) => unassignArea(t, { areaId: maadi.id, actorUserId: actor }));
    expect(await zonesContaining(prisma, { latitude: maadi.lat, longitude: maadi.lng })).toEqual(
      [],
    );
    const audit = await prisma.auditLog.findMany({
      where: { entityType: 'geo_area', entityId: maadi.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual(['store_area.assign', 'store_area.unassign']);
  });

  it('refuses hubs, governorates and areas another store serves unless moved', async () => {
    const hub = await prisma.darkStore.create({
      data: {
        kind: 'hub',
        code: 'HUB',
        nameEn: 'Hub',
        nameAr: 'Hub',
        addressEn: 'x',
        addressAr: 'x',
        governorateId: 1,
        latitude: 30,
        longitude: 31,
      },
    });
    const hubZone = await zoneOf(hub.id, 'HUBZ');
    const maadi = await district('Maadi');
    await expect(
      tx((t) => assignArea(t, { areaId: maadi.id, zoneId: hubZone.id, actorUserId: actor })),
    ).rejects.toMatchObject({ code: 'hub_has_no_zones' });
    const cairo = await prisma.geoArea.findFirstOrThrow({ where: { level: 1, nameEn: 'Cairo' } });
    const zone = await zoneOf(f.store.id, 'MAA');
    await expect(
      tx((t) => assignArea(t, { areaId: cairo.id, zoneId: zone.id, actorUserId: actor })),
    ).rejects.toMatchObject({ code: 'area_level_not_assignable' });

    await tx((t) => assignArea(t, { areaId: maadi.id, zoneId: zone.id, actorUserId: actor }));
    const other = await zoneOf(f.other.id, 'OTH');
    const degla = await neighbourhood('t:degla', 'Degla', 'دجله', 'Maadi');
    // Degla is served through Maadi by the first store.
    await expect(
      tx((t) => assignArea(t, { areaId: degla.id, zoneId: other.id, actorUserId: actor })),
    ).rejects.toMatchObject({ code: 'area_served_by_other_store' });
    await tx((t) =>
      assignArea(t, { areaId: degla.id, zoneId: other.id, move: true, actorUserId: actor }),
    );
    // The carved out neighbourhood belongs to the other store's polygon, and no longer to Maadi's.
    const at = { latitude: degla.lat, longitude: degla.lng };
    expect((await zonesContaining(prisma, at)).map((z) => z.id)).toEqual([other.id]);
    expect((await resolveDelivery(prisma, { areaId: degla.id })).store?.id).toBe(f.other.id);
  });

  it('marks an area not served inside a served district', async () => {
    const zone = await zoneOf(f.store.id, 'MAA');
    const maadi = await district('Maadi');
    const degla = await neighbourhood('t:degla', 'Degla', 'دجله', 'Maadi');
    await tx((t) => assignArea(t, { areaId: maadi.id, zoneId: zone.id, actorUserId: actor }));
    await tx((t) => excludeArea(t, { areaId: degla.id, actorUserId: actor, note: 'gated' }));
    expect(await zonesContaining(prisma, { latitude: degla.lat, longitude: degla.lng })).toEqual(
      [],
    );
    expect(await resolveDelivery(prisma, { areaId: degla.id })).toMatchObject({
      status: 'outside',
      reason: 'area_not_served',
    });
    // Maadi as a whole is still served: the gap is far under 2% of it (the 98% rule).
    expect((await resolveDelivery(prisma, { areaId: maadi.id })).status).toBe('served');
    // The map shows who serves what.
    const map = await listAreasForMap(prisma, { districtId: maadi.id, levels: [2, 3] });
    expect(map.areas.find((a) => a.id === degla.id)?.owner).toMatchObject({ excluded: true });
    expect(map.areas.find((a) => a.id === maadi.id)?.owner).toMatchObject({
      zoneId: zone.id,
      inherited: false,
    });
  });

  it('selects the areas inside a drawn shape', async () => {
    const zone = await zoneOf(f.store.id, 'MAA');
    const maadi = await district('Maadi');
    const shape = (
      await prisma.$queryRaw<{ g: string }[]>`
      SELECT ST_AsGeoJSON(ST_Buffer(geom, 0.005)) AS g FROM geo_areas WHERE id = ${maadi.id}`
    )[0]!.g;
    const done = await tx((t) =>
      assignAreasInShape(t, {
        zoneId: zone.id,
        shape: JSON.parse(shape),
        level: 2,
        actorUserId: actor,
      }),
    );
    expect(done.assigned).toContain(maadi.id);
  });
});

describe('the one delivery decision', () => {
  it('trusts a pin, then the chosen area, then the text; a door point is always real', async () => {
    const zone = await zoneOf(f.store.id, 'MAA');
    const maadi = await district('Maadi');
    const zayed = await district('Sheikh Zayed');
    await tx((t) => assignArea(t, { areaId: maadi.id, zoneId: zone.id, actorUserId: actor }));

    const pin = await resolveDelivery(prisma, {
      point: { latitude: maadi.lat, longitude: maadi.lng, source: 'pin' },
      addressText: 'Sheikh Zayed',
    });
    expect(pin).toMatchObject({
      status: 'served',
      confidence: 'point',
      doorPoint: { latitude: maadi.lat },
      zone: { id: zone.id },
    });
    const pinOut = await resolveDelivery(prisma, {
      point: { latitude: zayed.lat, longitude: zayed.lng },
      addressText: 'Maadi',
    });
    expect(pinOut.status).toBe('outside');

    expect(await resolveDelivery(prisma, { areaId: maadi.id, addressText: 'Zayed' })).toMatchObject(
      {
        status: 'served',
        confidence: 'chosen',
        doorPoint: null,
      },
    );
    expect(await resolveDelivery(prisma, { addressText: 'Road 9, Maadi, Cairo' })).toMatchObject({
      status: 'served',
      confidence: 'text',
      doorPoint: null,
      area: { id: maadi.id },
    });
    expect(await resolveDelivery(prisma, { addressText: 'Villa 2, Sheikh Zayed' })).toMatchObject({
      status: 'outside',
    });
    expect(await resolveDelivery(prisma, { addressText: 'Building 4, floor 2' })).toMatchObject({
      status: 'unsure',
    });
  });

  it('answers unsure when the address is equally two areas served by different stores', async () => {
    const a = await zoneOf(f.store.id, 'MAA');
    const b = await zoneOf(f.other.id, 'HEL');
    const maadi = await district('Maadi');
    const heliopolis = await district('Heliopolis');
    await tx((t) => assignArea(t, { areaId: maadi.id, zoneId: a.id, actorUserId: actor }));
    await tx((t) => assignArea(t, { areaId: heliopolis.id, zoneId: b.id, actorUserId: actor }));
    expect(await resolveDelivery(prisma, { addressText: 'Maadi, Heliopolis' })).toMatchObject({
      status: 'unsure',
      reason: 'stores_tie',
    });
    // Both served by the same zone: no doubt about the store.
    await tx((t) =>
      assignArea(t, { areaId: heliopolis.id, zoneId: a.id, move: true, actorUserId: actor }),
    );
    expect(await resolveDelivery(prisma, { addressText: 'Maadi, Heliopolis' })).toMatchObject({
      status: 'served',
      zone: { id: a.id },
    });
  });

  it('asks the lookup after the choice and before the engine, and goes on when it fails', async () => {
    const zone = await zoneOf(f.store.id, 'MAA');
    const maadi = await district('Maadi');
    await tx((t) => assignArea(t, { areaId: maadi.id, zoneId: zone.id, actorUserId: actor }));
    let calls = 0;
    const found = await resolveDelivery(prisma, {
      addressText: 'Somewhere unknown 5',
      geocode: async () => {
        calls++;
        return { latitude: maadi.lat, longitude: maadi.lng };
      },
    });
    expect(found).toMatchObject({ status: 'served', pointSource: 'geocoder', confidence: 'point' });
    await resolveDelivery(prisma, {
      areaId: maadi.id,
      addressText: 'Somewhere unknown 5',
      geocode: async () => {
        calls++;
        return null;
      },
    });
    expect(calls).toBe(1);
    expect(
      await resolveDelivery(prisma, {
        addressText: 'Nowhere 1',
        geocode: async () => {
          throw new Error('down');
        },
      }),
    ).toMatchObject({ status: 'unsure', reason: 'geocoder_failed' });
    expect(
      (
        await resolveDelivery(prisma, {
          addressText: 'Road 9, Maadi',
          geocode: async () => {
            throw new Error('down');
          },
        })
      ).status,
    ).toBe('served');
  });

  it('learns an address from two deliveries within 150 m, and uses it first', async () => {
    const zone = await zoneOf(f.store.id, 'MAA');
    const maadi = await district('Maadi');
    await tx((t) => assignArea(t, { areaId: maadi.id, zoneId: zone.id, actorUserId: actor }));
    const text = 'Villa 7, Street 230';
    const order = async (i: number) =>
      (
        await prisma.order.create({
          data: {
            number: `L-${i}`,
            merchantId: f.merchant.id,
            darkStoreId: f.store.id,
            customerName: 'x',
            customerPhone: '+201000000000',
            addressText: text,
            paymentMethod: 'cod',
            deliveryOtp: '1234',
            trackingToken: `L-${i}`,
            subtotalPiastres: 1000,
            placedAt: new Date(),
          },
        })
      ).id;
    expect((await resolveDelivery(prisma, { addressText: text })).status).toBe('unsure');
    await recordDeliveredPoint(prisma, {
      orderId: await order(1),
      addressText: text,
      point: { latitude: maadi.lat, longitude: maadi.lng },
    });
    // One delivery is not enough.
    expect((await resolveDelivery(prisma, { addressText: text })).status).toBe('unsure');
    await recordDeliveredPoint(prisma, {
      orderId: await order(2),
      addressText: 'villa 7 street 230',
      point: { latitude: maadi.lat + 0.0005, longitude: maadi.lng },
    });
    expect(await resolveDelivery(prisma, { addressText: text })).toMatchObject({
      status: 'served',
      confidence: 'learned',
      pointSource: 'learned',
      zone: { id: zone.id },
    });
  });

  it('finds served neighbourhoods by name, in Arabic and English', async () => {
    const zone = await zoneOf(f.store.id, 'MAA');
    const maadi = await district('Maadi');
    const degla = await neighbourhood('t:degla', 'Degla', 'دجله', 'Maadi');
    await neighbourhood('t:dokki-x', 'Deglawy', 'دجلاوي', 'Dokki');
    expect(await searchServedAreas(prisma, { q: 'degla' })).toEqual([]);
    await tx((t) => assignArea(t, { areaId: maadi.id, zoneId: zone.id, actorUserId: actor }));
    const found = await searchServedAreas(prisma, { q: 'دجله' });
    expect(found).toEqual([
      expect.objectContaining({
        id: degla.id,
        zoneId: zone.id,
        store: expect.objectContaining({ code: 'TST' }),
      }),
    ]);
    // Only the given stores.
    expect(await searchServedAreas(prisma, { q: 'degla', storeIds: [f.other.id] })).toEqual([]);
  });
});

describe('zones from the drawn outlines', () => {
  it('assigns districts at least 60% inside, flags split ones, keeps empty zones, runs once', async () => {
    const maadi = await district('Maadi');
    const a = await zoneOf(f.store.id, 'MAA');
    const b = await zoneOf(f.other.id, 'OTH');
    const lonely = await zoneOf(f.store.id, 'TINY');
    // Store A's outline holds all of Maadi; store B's holds a small corner of it too.
    await prisma.$executeRaw`
      UPDATE zones SET legacy_area = (SELECT ST_Multi(ST_Buffer(geom, 0.002)) FROM geo_areas WHERE id = ${maadi.id}),
        area = (SELECT ST_Multi(ST_Buffer(geom, 0.002)) FROM geo_areas WHERE id = ${maadi.id})
      WHERE id = ${a.id}`;
    await prisma.$executeRaw`
      UPDATE zones SET area = (SELECT ST_Multi(ST_Buffer(ST_PointOnSurface(geom), 0.01)) FROM geo_areas WHERE id = ${maadi.id})
      WHERE id = ${b.id}`;
    await prisma.$executeRaw`
      UPDATE zones SET area = ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(31.0, 30.5), 4326), 0.001))
      WHERE id = ${lonely.id}`;

    const moved = await assignAreasFromOutlines(prisma);
    expect(moved).toMatchObject({ done: true, level: 2 });
    const row = await prisma.storeArea.findUniqueOrThrow({ where: { geoAreaId: maadi.id } });
    expect(row).toMatchObject({ zoneId: a.id, needsReview: true });
    expect((await listAreasToReview(prisma)).map((r) => r.areaId)).toEqual([maadi.id]);
    const alert = await prisma.alert.findFirstOrThrow({ where: { type: 'zone_areas_review' } });
    expect(alert.data).toMatchObject({
      zonesKeptOutline: expect.arrayContaining([{ zoneId: lonely.id, code: 'TINY' }]),
    });
    // The zone with no area keeps its outline; the other is now Maadi itself.
    expect(
      (await zonesContaining(prisma, { latitude: 30.5, longitude: 31.0 })).map((z) => z.id),
    ).toEqual([lonely.id]);
    expect(await assignAreasFromOutlines(prisma)).toMatchObject({ done: false });
    // Through prepareAreaMap too: nothing changes on a second run.
    const again = await prepareAreaMap(prisma);
    expect(again.outlines.done).toBe(false);
    expect(again.cleanUp).toMatchObject({ mergedDistricts: 0, reshaped: 0, foldedIntoDistrict: 0 });
  });

  it('does nothing on a database without an area map', async () => {
    await prisma.geoArea.deleteMany({});
    const z = await zoneOf(f.store.id, 'MAA');
    await prisma.$executeRaw`
      UPDATE zones SET area = ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(31.25, 29.96), 4326), 0.01))
      WHERE id = ${z.id}`;
    expect(await assignAreasFromOutlines(prisma)).toMatchObject({ done: false });
    expect(await prisma.auditLog.count({ where: { action: 'zones.areas_from_outlines' } })).toBe(0);
  });
});

describe('area map clean up', () => {
  it('merges duplicate districts, places lost neighbourhoods, folds a city into its district', async () => {
    await resetDatabase();
    f = await createFixture();
    await loadBaseAreas(prisma);
    const before = await prisma.geoArea.count({ where: { level: 2, nameEn: 'New Cairo' } });
    expect(before).toBeGreaterThan(1);
    // A neighbourhood under the governorate only, lying inside Maadi.
    const maadiPoint = await district('Maadi');
    const lostId = await upsertArea(prisma, {
      ref: 't:lost',
      level: 3,
      nameEn: 'Lost Gardens',
      nameAr: 'حدائق تايهه',
      aliases: [],
      source: 'test',
      geometry: square(maadiPoint.lng, maadiPoint.lat, 0.002),
    });
    const cairo = await prisma.geoArea.findFirstOrThrow({ where: { level: 1, nameEn: 'Cairo' } });
    await prisma.geoArea.update({ where: { id: lostId! }, data: { parentId: cairo.id } });
    // "El Shorouk City" filed as a compound covering the district.
    const shorouk = await district('El Shorouk');
    const shape = (
      await prisma.$queryRaw<{ g: string }[]>`
      SELECT ST_AsGeoJSON(ST_Buffer(geom, -0.001)) AS g FROM geo_areas WHERE id = ${shorouk.id}`
    )[0]!.g;
    const cityId = await upsertArea(prisma, {
      ref: 't:shorouk-city',
      level: 4,
      nameEn: 'El Shorouk City',
      nameAr: 'مدينة الشروق',
      aliases: ['shorouk city'],
      source: 'test',
      geometry: JSON.parse(shape),
    });

    const first = await cleanUpAreas(prisma);
    expect(first.mergedDistricts).toBeGreaterThan(0);
    expect(first.foldedIntoDistrict).toBe(1);
    expect(
      await prisma.geoArea.count({ where: { level: 2, nameEn: 'New Cairo', isActive: true } }),
    ).toBe(1);
    const lost = await prisma.geoArea.findUniqueOrThrow({
      where: { id: lostId! },
      include: { parent: true },
    });
    expect(lost.parent?.nameEn).toBe('Maadi');
    const city = await prisma.geoArea.findUniqueOrThrow({ where: { id: cityId! } });
    expect(city).toMatchObject({ isActive: false, mergedIntoId: shorouk.id });
    const kept = await prisma.geoArea.findUniqueOrThrow({ where: { id: shorouk.id } });
    expect(kept.aliases).toContain('shorouk city');

    // A reload of the base map resets the kept district's shape; the clean up joins it again.
    await loadBaseAreas(prisma);
    const second = await cleanUpAreas(prisma);
    expect(second).toMatchObject({ mergedDistricts: 0, foldedIntoDistrict: 0, parented: 0 });
    expect(second.reshaped).toBeGreaterThan(0);
    expect(await cleanUpAreas(prisma)).toEqual({
      mergedDistricts: 0,
      reshaped: 0,
      parented: 0,
      foldedIntoDistrict: 0,
    });
    forgetAreaNames();
    const r = await readAddress(prisma, 'Villa 3, 5th settlement, New Cairo');
    expect(r).toMatchObject({
      status: 'area',
      areas: [expect.objectContaining({ nameEn: 'New Cairo' })],
    });
  });

  it('adds the missed names (Sherouk, Mokattam) where the map has the place', async () => {
    const khalifa = await district('El Khalifa');
    await upsertArea(prisma, {
      ref: 't:mokattam',
      level: 3,
      nameEn: 'El Mukkatam',
      nameAr: 'المقطم',
      aliases: [],
      source: 'test',
      geometry: square(khalifa.lng, khalifa.lat, 0.002),
    });
    await applyAreaDictionary(prisma);
    forgetAreaNames();
    for (const [text, name] of [
      ['Sherouk1, building 4', 'El Shorouk'],
      ['Street 9, Mokattam', 'El Mukkatam'],
      ['شارع 9 مقطم', 'El Mukkatam'],
    ] as const) {
      const r = await readAddress(prisma, text);
      expect(r.status === 'area' && r.areas[0]!.nameEn).toBe(name);
    }
  });
});
