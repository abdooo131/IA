import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, FixedClock, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';
const PASSWORD = 'team-password-1';
// Wednesday 14 January 2026, 12:00 in Cairo: every seeded store is open.
const NOON_CAIRO = new Date('2026-01-14T10:00:00Z');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

/** HR step 2 (docs/HR.md 2): Clock in with a location check, the board, roster and rules. */
describe('attendance', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let stores: Map<string, string>;
  let admin: ReturnType<typeof request.agent>;
  const clock = new FixedClock(NOON_CAIRO);

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const member = async (email: string, jobRole: string, extra: Record<string, unknown> = {}) => {
    await admin
      .post('/admin/users')
      .send({ email, name: email, role: 'admin', jobRole, password: PASSWORD, ...extra })
      .expect(201);
    return agent(email, PASSWORD);
  };
  const storeAt = async (code: string) => {
    const s = await prisma.darkStore.findUniqueOrThrow({ where: { code } });
    return { lat: s.latitude, lng: s.longitude, accuracy: 12 };
  };
  const fileOf = (email: string) =>
    prisma.employee.findFirstOrThrow({ where: { user: { email } } });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ clock }));
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    clock.set(NOON_CAIRO);
    ({ stores } = await resetAndSeed(prisma));
    admin = await agent('admin@test.eg', 'admin-password-1');
  });

  it('lets every person clock in at their own store and read only their own days', async () => {
    const staff = await agent('staff.newcairo@shiplynow.local');
    const ncr = await storeAt('NCR');
    const far = await staff
      .post('/me/attendance/clock-in')
      .send({ ...(await storeAt('MAA')) })
      .expect(403);
    expect(far.body).toMatchObject({ error: 'too_far', radiusM: 150 });
    expect(far.body.distanceM).toBeGreaterThan(5000);
    const blurry = await staff
      .post('/me/attendance/clock-in')
      .send({ ...ncr, accuracy: 400 })
      .expect(400);
    expect(blurry.body).toMatchObject({ error: 'position_inaccurate', maxAccuracyM: 100 });
    expect((await staff.post('/me/attendance/clock-in').send({}).expect(400)).body.error).toBe(
      'no_position',
    );

    const done = await staff
      .post('/me/attendance/clock-in')
      .send({ ...ncr, device: 'Test phone' })
      .expect(201);
    expect(done.body.punch).toMatchObject({ kind: 'in', distanceM: 0 });
    expect(done.body.today).toMatchObject({ clockedIn: true });
    expect((await staff.post('/me/attendance/clock-in').send(ncr).expect(409)).body.error).toBe(
      'already_clocked_in',
    );

    const mine = (await staff.get('/me/attendance').expect(200)).body;
    expect(mine.place).toMatchObject({ kind: 'store', nameEn: expect.any(String), ready: true });
    expect(mine.today.clockedIn).toBe(true);

    // A rider's own page is theirs too; merchants have no file; nobody else's board.
    const rider = await agent('rider.maadi@shiplynow.local');
    expect((await rider.get('/me/attendance').expect(200)).body.today.clockedIn).toBe(false);
    await rider.get('/hr/attendance/today').expect(403);
    await staff.get('/hr/attendance/today').expect(403);
    const merchant = await agent('merchant@evechantelle.example');
    await merchant.get('/me/attendance').expect(404);
  });

  it('shows store managers only their stores and leaves corrections to HR', async () => {
    const ncrStaff = await fileOf('staff.newcairo@shiplynow.local');
    const lead = await member('lead.maadi@shiply.eg', 'store_manager', {
      storeIds: [stores.get('MAA')],
    });
    const board = (await lead.get('/hr/attendance/today').expect(200)).body;
    expect(board.people.every((p: { store: { code: string } }) => p.store.code === 'MAA')).toBe(
      true,
    );
    expect(board.people.length).toBe(2); // the store's staff member and rider
    const other = await lead.get(`/hr/attendance/today?darkStoreId=${stores.get('NCR')}`);
    expect(other.status).toBe(403);
    expect(other.body.error).toBe('store_not_allowed');
    await lead.get(`/hr/roster?darkStoreId=${stores.get('MAA')}`).expect(200);
    await lead.get(`/hr/roster?darkStoreId=${stores.get('NCR')}`).expect(403);
    // HR view reads; corrections and shifts need more.
    const punch = {
      employeeId: ncrStaff.id,
      kind: 'in',
      at: '2026-01-14T07:55:00.000Z',
      reason: 'Phone was out of battery',
    };
    expect((await lead.post('/hr/attendance/punches').send(punch).expect(403)).body.error).toBe(
      'no_access',
    );
    await lead
      .post('/hr/shifts')
      .send({
        nameEn: 'Morning',
        start: '10:00',
        end: '16:00',
        breakMinutes: 30,
        weekdays: [0, 1, 2, 3, 4, 5, 6],
        overnight: false,
      })
      .expect(403);

    const hr = await member('hr@shiply.eg', 'hr_officer');
    const shift = (
      await hr
        .post('/hr/shifts')
        .send({
          nameEn: 'Morning',
          start: '10:00',
          end: '16:00',
          breakMinutes: 30,
          weekdays: [0, 1, 2, 3, 4, 5, 6],
          overnight: false,
        })
        .expect(201)
    ).body;
    await hr
      .patch(`/hr/employees/${ncrStaff.id}/default-shift`)
      .send({ shiftId: shift.id })
      .expect(200);
    await hr.post('/hr/attendance/punches').send(punch).expect(201);
    const day = (
      await hr.get(`/hr/attendance/day?employeeId=${ncrStaff.id}&day=2026-01-14`).expect(200)
    ).body;
    expect(day).toMatchObject({ closed: false, plan: { start: '2026-01-14T08:00:00.000Z' } });
    expect(day.punches).toHaveLength(1);
    const status = await hr
      .post('/hr/attendance/days/status')
      .send({ employeeId: ncrStaff.id, day: '2026-01-14', status: 'present', reason: 'Checked' })
      .expect(201);
    expect(status.body).toMatchObject({ status: 'present', overrideStatus: 'present' });

    const csv = await hr.get('/hr/attendance/days.csv?from=2026-01-14&to=2026-01-14').expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('present');
    // The store manager's list holds only their store's days.
    const leadDays = (await lead.get('/hr/attendance/days?from=2026-01-14&to=2026-01-14')).body;
    expect(leadDays).toEqual([]);
  });

  it('keeps riders who are not clocked in from taking orders when the setting is on', async () => {
    const ncr = stores.get('NCR')!;
    const merchant = await agent('merchant@evechantelle.example');
    const sku = await prisma.sku.findFirstOrThrow({ where: { sku: 'EC-001' } });
    const order = (
      await merchant
        .post('/merchant/orders')
        .send({
          customerName: 'Sara Ali',
          customerPhone: '01012345678',
          addressText: 'Villa 12',
          latitude: 30.03,
          longitude: 31.47,
          paymentMethod: 'cod',
          deliveryFeePiastres: 3000,
          items: [{ skuId: sku.id, quantity: 1 }],
        })
        .expect(201)
    ).body;
    const staff = await agent('staff.newcairo@shiplynow.local');
    const base = `/stores/${ncr}/orders/${order.id}`;
    await staff.post(`${base}/accept`).expect(201);
    await staff
      .post(`${base}/pick`)
      .send({ skuId: sku.id, quantity: 1, idempotencyKey: randomUUID() })
      .expect(201);
    const photo = await staff
      .post('/photos?kind=pack')
      .set('content-type', 'image/jpeg')
      .send(JPEG)
      .expect(201);
    await staff.post(`${base}/pack`).send({ photoId: photo.body.id }).expect(201);

    await admin
      .put('/admin/settings')
      .send({ key: 'hr.riders_must_clock_in', value: 1 })
      .expect(200);
    const refused = await staff
      .post(`${base}/handover`)
      .send({ badgeCode: 'RDR-0001' })
      .expect(409);
    expect(refused.body.error).toBe('rider_not_clocked_in');

    const rider = await agent('rider.newcairo@shiplynow.local');
    await rider
      .post('/me/attendance/clock-in')
      .send(await storeAt('NCR'))
      .expect(201);
    await staff.post(`${base}/handover`).send({ badgeCode: 'RDR-0001' }).expect(201);
  });
});
