import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type GeocodeResult, Geocoder } from '../src/coverage/geocoding';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, FixedClock, resetAndSeed } from './helpers';

// Seeded stores open 10:00 to 24:00 Cairo time. January: Cairo is UTC+2.
const NOON_CAIRO = new Date('2026-01-14T10:00:00Z');
const EIGHT_AM_CAIRO = new Date('2026-01-14T06:00:00Z');

const NEW_CAIRO = { lat: 30.03, lng: 31.47 };
const ALEXANDRIA = { lat: 31.2, lng: 29.92 };

class FakeGeocoder extends Geocoder {
  async geocode(address: string): Promise<GeocodeResult | null> {
    if (address.includes('90th')) {
      return {
        latitude: NEW_CAIRO.lat,
        longitude: NEW_CAIRO.lng,
        formattedAddress: '90th St, New Cairo',
      };
    }
    if (address.includes('Alexandria')) {
      return {
        latitude: ALEXANDRIA.lat,
        longitude: ALEXANDRIA.lng,
        formattedAddress: 'Alexandria',
      };
    }
    return null;
  }
}

describe('coverage', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const clock = new FixedClock(NOON_CAIRO);
  let stores: Map<string, string>;
  let adminCookie: string[];

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ clock, geocoder: new FakeGeocoder() }));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    clock.set(NOON_CAIRO);
    ({ stores } = await resetAndSeed(prisma));
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@test.eg', password: 'admin-password-1' })
      .expect(200);
    adminCookie = login.headers['set-cookie'] as unknown as string[];
  });

  const check = (query: Record<string, string | number>) =>
    request(app.getHttpServer()).get('/coverage').query(query);

  async function placeOrder(storeCode: string) {
    const merchant = await prisma.merchant.findFirstOrThrow();
    await prisma.order.create({
      data: {
        number: `T-${Math.random()}`,
        merchantId: merchant.id,
        darkStoreId: stores.get(storeCode)!,
        customerName: 'x',
        customerPhone: '+201000000000',
        addressText: 'x',
        paymentMethod: 'cod',
        deliveryOtp: '1234',
        trackingToken: `T-${Math.random()}`,
        subtotalPiastres: 1000,
        placedAt: new Date(clock.now().getTime() - 5 * 60_000),
      },
    });
  }

  it('a New Cairo address returns the New Cairo store', async () => {
    const res = await check(NEW_CAIRO).expect(200);
    expect(res.body).toMatchObject({
      covered: true,
      darkStore: { code: 'NCR', nameAr: 'القاهرة الجديدة' },
      zone: { code: 'NCR-5S' },
      promiseMinutes: 60,
    });
  });

  it('an address in Alexandria returns no coverage', async () => {
    const res = await check(ALEXANDRIA).expect(200);
    expect(res.body).toMatchObject({ covered: false, reason: 'outside_zones' });
  });

  it('accepts a text address through the geocoder', async () => {
    const hit = await check({ address: 'South 90th Street' }).expect(200);
    expect(hit.body).toMatchObject({
      covered: true,
      darkStore: { code: 'NCR' },
      location: { formattedAddress: '90th St, New Cairo' },
    });
    const alex = await check({ address: 'Alexandria corniche' }).expect(200);
    expect(alex.body.covered).toBe(false);
    const unknown = await check({ address: 'nowhere at all' }).expect(200);
    expect(unknown.body).toMatchObject({ covered: false, reason: 'outside_zones', location: null });
  });

  it('reports a closed store with its next opening time', async () => {
    clock.set(EIGHT_AM_CAIRO);
    const res = await check(NEW_CAIRO).expect(200);
    expect(res.body).toMatchObject({
      covered: false,
      reason: 'store_closed',
      darkStore: { code: 'NCR' },
      nextOpenAt: '2026-01-14T08:00:00.000Z',
    });
  });

  it('stops offering the store once it reaches its hourly capacity', async () => {
    await request(app.getHttpServer())
      .put(`/admin/dark-stores/${stores.get('NCR')}/capacity`)
      .set('Cookie', adminCookie)
      .send({ value: 2 })
      .expect(200);
    await placeOrder('NCR');
    expect((await check(NEW_CAIRO)).body.covered).toBe(true);
    await placeOrder('NCR');
    expect((await check(NEW_CAIRO)).body).toMatchObject({ covered: false, reason: 'at_capacity' });
  });

  it('with overlapping zones, picks the nearest store that is open and has room', async () => {
    await request(app.getHttpServer())
      .post('/admin/zones')
      .set('Cookie', adminCookie)
      .send({
        darkStoreId: stores.get('MAA'),
        code: 'MAA-OVERLAP',
        nameEn: 'Overlap',
        nameAr: 'تداخل',
        area: {
          type: 'Polygon',
          coordinates: [
            [
              [31.45, 30.02],
              [31.49, 30.02],
              [31.49, 30.04],
              [31.45, 30.04],
              [31.45, 30.02],
            ],
          ],
        },
      })
      .expect(201);
    expect((await check(NEW_CAIRO)).body.darkStore.code).toBe('NCR');

    await request(app.getHttpServer())
      .put(`/admin/dark-stores/${stores.get('NCR')}/capacity`)
      .set('Cookie', adminCookie)
      .send({ value: 0 })
      .expect(200);
    expect((await check(NEW_CAIRO)).body).toMatchObject({
      covered: true,
      darkStore: { code: 'MAA' },
    });
  });

  it('validates the query', async () => {
    await check({ lat: 'north', lng: 31 }).expect(400);
    await check({}).expect(400);
  });

  it('lists covered areas with Arabic names and a point inside each', async () => {
    const res = await request(app.getHttpServer()).get('/coverage/areas').expect(200);
    expect(res.body.map((a: { code: string }) => a.code)).toEqual(['MAA-ALL', 'NCR-5S', 'ZAM-ALL']);
    const maadi = res.body[0];
    expect(maadi).toMatchObject({ nameAr: 'المعادي', darkStore: { code: 'MAA' } });
    const back = await check({ lat: maadi.point.latitude, lng: maadi.point.longitude }).expect(200);
    expect(back.body).toMatchObject({ covered: true, zone: { code: 'MAA-ALL' } });
  });
});

describe('coverage without a geocoding key', () => {
  it('answers geocoding_not_configured for addresses but still works for points', async () => {
    const { app, prisma } = await createTestApp({ clock: new FixedClock(NOON_CAIRO) });
    await resetAndSeed(prisma);
    const res = await request(app.getHttpServer())
      .get('/coverage')
      .query({ address: 'Maadi road 9' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('geocoding_not_configured');
    await request(app.getHttpServer()).get('/coverage').query(NEW_CAIRO).expect(200);
    await app.close();
  });
});
