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

/** An agent courier login (no office app). */
export async function courier(name: string, mobile: string) {
  const { hash } = await import('argon2');
  const role = await db.jobRole.findUniqueOrThrow({ where: { key: 'field' } });
  const user = await db.user.create({ data: { name, nameAr: name, mobile: `+2${mobile}`, kind: 'agent_person', passwordHash: await hash(`${name}-pass-1`), roleId: role.id } });
  // An approved person of an active agent, so the work gate lets him work.
  const agent = await db.agent.upsert({ where: { code: 'FIX' }, create: { code: 'FIX', name: 'Fixture Agent', nameAr: 'وكيل', contactName: 'x', phone: '+201000000000', services: ['shiply'], perDelivery: 2000, perPickup: 1500 }, update: {} });
  await db.person.create({ data: { agentId: agent.id, userId: user.id, role: 'delivery', status: 'approved', createdById: user.id } });
  return user;
}

/** A scan as the phone sends it. */
export const scanBody = (step: string, code: string, extra: object = {}) => ({ step, code, deviceScanId: crypto.randomUUID(), ...extra });

type Post = (url: string, body: object, cookies?: string[]) => Promise<{ status: number; body: Record<string, unknown> & { id: string; tracking: string } }>;

/** Takes parcels through the scans up to a step, the way the floor does it. */
export async function walk(post: Post, cookies: { courier: string[]; staff: string[] }, ids: { merchantId: string; facilityId: string; courierId: string }, tracking: string[], upTo: 'picked_up' | 'at_inbound' | 'sorted', pickupId?: string) {
  let pid = pickupId;
  if (!pid) {
    pid = (await post('/parcels/pickups', { merchantId: ids.merchantId, date: '2026-11-10' })).body.id;
    await post(`/parcels/pickups/${pid}/assign`, { courierId: ids.courierId });
  }
  for (const t of tracking) await post('/parcels/scan', scanBody('pickup', t, { pickupId: pid }), cookies.courier);
  if (upTo === 'picked_up') return pid;
  for (const t of tracking) await post('/parcels/scan', scanBody('inbound', t, { siteId: ids.facilityId }), cookies.staff);
  if (upTo === 'at_inbound') return pid;
  for (const t of tracking) await post('/parcels/scan', scanBody('sorting', t, { siteId: ids.facilityId }), cookies.staff);
  return pid;
}
