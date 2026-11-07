import type { INestApplication } from '@nestjs/common';
import type { PushMessage, PushOutcome, PushTarget } from '@shiplynow/db';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JobsService } from '../src/jobs/jobs.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { PushSender } from '../src/push/push-sender';
import { createTestApp, FixedClock, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';
const NOON_CAIRO = new Date('2026-01-14T10:00:00Z');

/** Records pushes instead of calling the push services. */
class FakePush extends PushSender {
  enabled = true;
  publicKey: string | null = 'BPublicKeyForTests';
  sent: { endpoint: string; message: PushMessage }[] = [];
  mode: 'ok' | 'gone' | 'fail' = 'ok';
  async send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    if (this.mode === 'fail') throw new Error('push service answered 503');
    if (this.mode === 'gone') return 'gone';
    this.sent.push({ endpoint: target.endpoint, message });
    return 'sent';
  }
}

const device = (name: string, lang: 'en' | 'ar' = 'en') => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
  keys: {
    p256dh:
      'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
    auth: 'tBHItJI5svbpez7KI4CCXg',
  },
  lang,
});

describe('push notifications', () => {
  const push = new FakePush();
  const clock = new FixedClock(NOON_CAIRO);
  let app: INestApplication;
  let prisma: PrismaService;
  let jobs: JobsService;
  let ncr: string;

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ push, clock }));
    jobs = app.get(JobsService);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    push.enabled = true;
    push.publicKey = 'BPublicKeyForTests';
    push.mode = 'ok';
    push.sent = [];
    clock.set(NOON_CAIRO);
    ncr = (await resetAndSeed(prisma)).stores.get('NCR')!;
  });

  it('hides the switch while push is not configured', async () => {
    push.enabled = false;
    push.publicKey = null;
    const staff = await agent('staff.newcairo@shiplynow.local');
    const mine = await staff.get('/me/push').expect(200);
    expect(mine.body).toMatchObject({ configured: false, publicKey: null, devices: [] });
    const refused = await staff.post('/me/push/subscriptions').send(device('a')).expect(404);
    expect(refused.body.error).toBe('push_not_configured');
  });

  it('lets each person add devices, choose types, test and remove', async () => {
    const staff = await agent('staff.newcairo@shiplynow.local');
    const mine = await staff.get('/me/push').expect(200);
    expect(mine.body.configured).toBe(true);
    expect(mine.body.publicKey).toBe('BPublicKeyForTests');
    const types = mine.body.types.map((t: { type: string }) => t.type);
    expect(types).toEqual(expect.arrayContaining(['order_new', 'order_late', 'ticket']));
    expect(types).not.toContain('finance_approval');

    await staff
      .post('/me/push/subscriptions')
      .set('user-agent', 'Mozilla/5.0 (iPhone)')
      .send(device('phone', 'ar'))
      .expect(200);
    await staff.post('/me/push/subscriptions').send(device('laptop')).expect(200);
    const devices = (await staff.get('/me/push').expect(200)).body.devices;
    expect(devices).toHaveLength(2);

    await staff.put('/me/push/preferences').send({ type: 'order_new', enabled: false }).expect(200);
    const refused = await staff
      .put('/me/push/preferences')
      .send({ type: 'finance_approval', enabled: false })
      .expect(403);
    expect(refused.body.error).toBe('no_access');
    expect(
      (await staff.get('/me/push')).body.types.find(
        (t: { type: string }) => t.type === 'order_new',
      ),
    ).toEqual({ type: 'order_new', enabled: false });

    const test = await staff.post('/me/push/test').expect(200);
    expect(test.body).toEqual({ sent: 2, failed: 0, gone: 0 });
    expect(push.sent.map((s) => s.message.title).sort()).toEqual([
      'Test notification',
      'إشعار تجريبي',
    ]);

    // Someone else cannot remove these devices.
    const merchant = await agent('merchant@evechantelle.example');
    await merchant.delete(`/me/push/subscriptions/${devices[0].id}`).expect(404);
    const merchantTypes = (await merchant.get('/me/push').expect(200)).body.types.map(
      (t: { type: string }) => t.type,
    );
    expect(merchantTypes).toEqual(['merchant_order', 'merchant_payout', 'merchant_low_stock']);

    await staff.delete(`/me/push/subscriptions/${devices[0].id}`).expect(200);
    await staff
      .post('/me/push/subscriptions/remove')
      .send({ endpoint: device('phone').endpoint })
      .expect(200);
    expect((await staff.get('/me/push')).body.devices).toEqual([]);
  });

  it('a device used by another person moves to them', async () => {
    const staff = await agent('staff.newcairo@shiplynow.local');
    const rider = await agent('rider.newcairo@shiplynow.local');
    await staff.post('/me/push/subscriptions').send(device('shared')).expect(200);
    await rider.post('/me/push/subscriptions').send(device('shared')).expect(200);
    expect((await staff.get('/me/push')).body.devices).toEqual([]);
    expect((await rider.get('/me/push')).body.devices).toHaveLength(1);
    expect((await rider.get('/me/push')).body.types.map((t: { type: string }) => t.type)).toEqual([
      'rider_order',
      'ticket',
      'attendance_late',
      'document_expiring',
      'hr_request',
      'hr_update',
      'rider_wallet',
    ]);
  });

  it('tells the store about a new order and the assignee about a ticket, once', async () => {
    const staff = await agent('staff.newcairo@shiplynow.local');
    await staff.post('/me/push/subscriptions').send(device('staff', 'ar')).expect(200);
    const finance = await agent('finance@shiplynow.local');
    await finance.post('/me/push/subscriptions').send(device('finance')).expect(200);

    const merchant = await agent('merchant@evechantelle.example');
    const sku = await prisma.sku.findFirstOrThrow({ where: { sku: 'EC-001' } });
    const order = await merchant
      .post('/merchant/orders')
      .send({
        customerName: 'Sara Ali',
        customerPhone: '0101 234 5678',
        addressText: 'Villa 12, South 90th St',
        latitude: 30.03,
        longitude: 31.47,
        paymentMethod: 'cod',
        deliveryFeePiastres: 3000,
        items: [{ skuId: sku.id, quantity: 1 }],
      })
      .expect(201);
    const boss = await agent('admin@test.eg', 'admin-password-1');
    const financeUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'finance@shiplynow.local' },
    });
    await boss
      .post('/tickets')
      .send({
        title: 'Check payout',
        body: 'Please',
        assigneeId: financeUser.id,
        priority: 'normal',
      })
      .expect(201);

    await jobs.runPush();
    const got = push.sent.map((s) => [s.endpoint.split('/').pop(), s.message.title, s.message.url]);
    expect(got).toEqual(
      expect.arrayContaining([
        ['staff', `طلب جديد ${order.body.number}`, `/store/${ncr}/orders/${order.body.id}`],
        ['finance', 'Ticket TCK-000001: Check payout', expect.stringMatching(/^\/tickets\//)],
      ]),
    );
    expect(got).toHaveLength(2);
    push.sent = [];
    await jobs.runPush();
    expect(push.sent).toEqual([]);
  });

  it('never breaks the action when push fails, and drops devices that are gone', async () => {
    const finance = await agent('finance@shiplynow.local');
    await finance.post('/me/push/subscriptions').send(device('finance')).expect(200);
    const financeUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'finance@shiplynow.local' },
    });
    push.mode = 'fail';
    const boss = await agent('admin@test.eg', 'admin-password-1');
    await boss
      .post('/tickets')
      .send({ title: 'Broken push', body: 'x', assigneeId: financeUser.id, priority: 'normal' })
      .expect(201);
    const result = await jobs.runPush();
    expect(result).toMatchObject({ events: 1, failed: 1 });
    const alert = await prisma.alert.findFirstOrThrow({ where: { type: 'server_error' } });
    expect(alert.data).toMatchObject({ source: 'push', message: 'push service answered 503' });
    expect(
      (await prisma.pushSubscription.findFirstOrThrow({ where: { userId: financeUser.id } }))
        .failures,
    ).toBe(1);

    push.mode = 'gone';
    const test = await finance.post('/me/push/test').expect(200);
    expect(test.body).toEqual({ sent: 0, failed: 0, gone: 1 });
    expect(await prisma.pushSubscription.count({ where: { userId: financeUser.id } })).toBe(0);
  });
});
