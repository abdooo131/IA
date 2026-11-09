import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { db } from './helpers';

/** A facility, a hub fed by it, a zone on Maadi, and a merchant priced for Cairo (small: 45 EGP). */
export async function network(app: INestApplication, owner: string[]) {
  const post = (url: string, body: object) => request(app.getHttpServer()).post(url).set('Cookie', owner).send(body);
  const facility = (await post('/location/sites', { kind: 'sorting_facility', code: 'OBR', nameEn: 'Obour facility', nameAr: 'مركز فرز العبور' })).body;
  const hub = (await post('/location/sites', { kind: 'last_mile_hub', code: 'MAA', nameEn: 'Maadi hub', nameAr: 'مركز المعادي', sortingFacilityId: facility.id })).body;
  const zone = (await post('/location/zones', { hubId: hub.id, code: 'MAA-A', nameEn: 'Maadi A', nameAr: 'المعادي أ' })).body;
  await request(app.getHttpServer()).put('/location/map/maadi').set('Cookie', owner).send({ zoneId: zone.id, notServed: false });
  const owner1 = await db.user.findFirstOrThrow({ where: { email: 'owner@test.local' } });
  const merchant = await db.merchant.create({ data: { code: 'EVE', name: 'Eve', contactName: 'Mona', contactPhone: '+201012345678', services: ['shiply'], status: 'approved', pickupPlaceId: 'maadi', pickupAddress: 'Maadi' } });
  const pz = await db.pricingZone.create({ data: { code: 'GC', nameEn: 'Greater Cairo', nameAr: 'القاهرة الكبرى', areas: { create: [{ placeId: 'cairo' }] } } });
  const contract = await db.contract.create({ data: { merchantId: merchant.id, number: 'C-1' } });
  await db.contractVersion.create({
    data: { contractId: contract.id, version: 1, status: 'active', startDate: new Date('2026-01-01'), createdById: owner1.id, codFeeBp: 100, returnFeeBp: 5000, openPackageFee: 500, deliveryAttempts: 3, prices: { create: [{ pricingZoneId: pz.id, size: 'small', price: 4500 }] } },
  });
  return { facility, hub, zone, merchant };
}
