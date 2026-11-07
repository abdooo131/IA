import { JOB_ROLE_TEMPLATES, type JobRole } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { writeAccess } from '../src/access';
import {
  dispatchPush,
  notify,
  type PushMessage,
  type PushOutcome,
  type PushSender,
  type PushTarget,
  setPushPreference,
} from '../src/push';
import { setSetting } from '../src/settings';
import { addTicketMessage, createTicket } from '../src/tickets';
import { createFixture, prisma, resetDatabase } from './helpers';

/** Records every push; endpoints listed in `gone` answer 410, in `failing` throw. */
class FakePush implements PushSender {
  enabled = true;
  sent: { endpoint: string; message: PushMessage }[] = [];
  gone = new Set<string>();
  failing = new Set<string>();
  async send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    if (this.failing.has(target.endpoint)) throw new Error('push service answered 500');
    if (this.gone.has(target.endpoint)) return 'gone';
    this.sent.push({ endpoint: target.endpoint, message });
    return 'sent';
  }
  /** Who got something, by the device's endpoint name (https://push.test/<name>). */
  to() {
    return this.sent.map((s) => s.endpoint.replace('https://push.test/', '')).sort();
  }
}

let NOW = new Date();
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

let fx: Awaited<ReturnType<typeof createFixture>>;
let users: Record<string, string>;
let push: FakePush;

async function person(
  name: string,
  role: 'admin' | 'finance' | 'store_staff' | 'rider' | 'merchant',
  options: {
    job?: JobRole;
    access?: Partial<(typeof JOB_ROLE_TEMPLATES)[JobRole]>;
    stores?: string[];
    lang?: 'en' | 'ar';
    merchantRole?: 'owner' | 'member';
    rights?: string[];
  } = {},
) {
  const user = await prisma.user.create({
    data: {
      email: `${name}@t.eg`,
      name,
      role,
      passwordHash: 'x',
      ...(role === 'merchant' && {
        merchantId: fx.merchant.id,
        merchantRole: options.merchantRole ?? 'owner',
        merchantRights: options.rights ?? [],
      }),
    },
  });
  if (options.job)
    await prisma.$transaction((tx) =>
      writeAccess(
        tx,
        user.id,
        { ...JOB_ROLE_TEMPLATES[options.job!], ...options.access, jobRole: 'custom' },
        options.stores ?? [],
      ),
    );
  await prisma.pushSubscription.create({
    data: {
      userId: user.id,
      endpoint: `https://push.test/${name}`,
      p256dh: 'BKey',
      auth: 'auth',
      lang: options.lang ?? 'en',
    },
  });
  return user.id;
}

beforeEach(async () => {
  await resetDatabase();
  NOW = new Date();
  fx = await createFixture();
  push = new FakePush();
  users = {
    staff: await person('staff', 'store_staff', {
      job: 'store_staff',
      stores: [fx.store.id],
      lang: 'ar',
    }),
    otherStaff: await person('otherStaff', 'store_staff', {
      job: 'store_staff',
      stores: [fx.other.id],
    }),
    owner: await person('owner', 'admin', { job: 'owner' }),
    ops: await person('ops', 'admin', { job: 'operations_manager', access: { store: 'none' } }),
    finance: await person('finance', 'finance', { job: 'finance_officer' }),
    approver: await person('approver', 'finance', { job: 'finance_manager' }),
    hr: await person('hr', 'admin', { job: 'hr_officer' }),
    am: await person('am', 'admin', {
      job: 'account_manager',
      access: { ownMerchantsOnly: true },
    }),
    merchant: await person('merchant', 'merchant'),
    member: await person('member', 'merchant', { merchantRole: 'member', rights: ['orders'] }),
    rider: await person('rider', 'rider'),
  };
  await prisma.merchant.update({
    where: { id: fx.merchant.id },
    data: { accountManagerId: users.am },
  });
});

afterAll(() => prisma.$disconnect());

let n = 0;
async function order(data: Partial<{ status: 'new' | 'packed'; createdAt: Date; store: string }>) {
  n++;
  return prisma.order.create({
    data: {
      number: `SN-${1000 + n}`,
      merchantId: fx.merchant.id,
      darkStoreId: data.store ?? fx.store.id,
      status: data.status ?? 'new',
      customerName: 'Mona',
      customerPhone: '+201001234567',
      addressText: 'Maadi',
      deliveryOtp: '1234',
      trackingToken: `tok-${n}`,
      paymentMethod: 'cod',
      subtotalPiastres: 10_000,
      placedAt: data.createdAt ?? ago(1),
      createdAt: data.createdAt ?? ago(1),
    },
  });
}

const run = () => dispatchPush(prisma, push, { now: NOW });

describe('push notifications', () => {
  it('tells the staff of the store about a new order, in their language, once', async () => {
    const o = await order({});
    await order({ store: fx.other.id });
    await order({ createdAt: ago(40) }); // too old to notify
    const first = await run();
    expect(first.events).toBe(2);
    const forStore = push.sent.filter((s) => s.message.url.includes(o.id));
    expect(forStore.map((s) => s.endpoint.split('/').pop()).sort()).toEqual(['owner', 'staff']);
    expect(forStore.find((s) => s.endpoint.endsWith('staff'))!.message).toMatchObject({
      title: `طلب جديد ${o.number}`,
      url: `/store/${fx.store.id}/orders/${o.id}`,
      tag: `order-${o.id}`,
      urgent: true,
    });
    expect(forStore.find((s) => s.endpoint.endsWith('owner'))!.message.title).toBe(
      `New order ${o.number}`,
    );
    expect(push.to()).toContain('otherStaff');
    push.sent = [];
    await run();
    expect(push.sent).toEqual([]);
  });

  it('respects the switches people turned off', async () => {
    await setPushPreference(prisma, users.owner!, 'order_new', false);
    await order({});
    await run();
    expect(push.to()).toEqual(['staff']);
  });

  it('sends late orders to the store and pages operations, account managers and admins', async () => {
    const o = await order({ status: 'packed' });
    await prisma.alert.create({
      data: { type: 'late', stage: 'handover', orderId: o.id, darkStoreId: fx.store.id },
    });
    await prisma.alert.create({ data: { type: 'server_error', data: { message: 'boom' } } });
    await run();
    const late = push.sent.filter((s) => s.message.tag === `order-${o.id}`);
    expect(late.map((s) => s.endpoint.split('/').pop()).sort()).toEqual([
      'am',
      'ops',
      'owner',
      'staff',
    ]);
    const staff = late.find((s) => s.endpoint.endsWith('/staff'))!.message;
    expect(staff.body).toContain('التسليم للمندوب');
    const ops = late.find((s) => s.endpoint.endsWith('/ops'))!.message;
    expect(ops).toMatchObject({ url: `/admin/orders/${o.id}`, title: `Order ${o.number} is late` });
    const am = late.find((s) => s.endpoint.endsWith('/am'))!.message;
    expect(am.url).toBe('/admin/alerts');
    const server = push.sent.filter((s) => s.message.title === 'Server error');
    expect(server.map((s) => s.endpoint.split('/').pop()).sort()).toEqual(['ops', 'owner']);
    expect(server[0]!.message.body).toBe('boom');
  });

  it('tells merchants managers about sign ups and HR and the person about documents', async () => {
    await prisma.alert.create({
      data: { type: 'merchant_signup', data: { name: 'Nile Pantry' } },
    });
    const employee = await prisma.employee.create({
      data: { userId: users.staff!, nameEn: 'Staff One', nameAr: 'موظف' },
    });
    await prisma.alert.create({
      data: {
        type: 'document_expiring',
        key: 'document_expiring:x',
        darkStoreId: fx.store.id,
        data: {
          employeeId: employee.id,
          kind: 'national_id',
          nameEn: 'Staff One',
          nameAr: 'موظف',
          expiresOn: '2026-12-01',
        },
      },
    });
    await run();
    const signup = push.sent.filter((s) => s.message.url === '/admin/merchants');
    expect(signup.map((s) => s.endpoint.split('/').pop())).toEqual(['owner']);
    expect(signup[0]!.message.body).toBe('Nile Pantry signed up.');
    const self = push.sent.find((s) => s.message.url === '/my-file')!;
    expect(self.endpoint).toMatch(/staff$/);
    expect(self.message.body).toContain('بطاقة الرقم القومي');
    const hr = push.sent.filter((s) => s.message.url === '/admin/hr/documents');
    expect(hr.map((s) => s.endpoint.split('/').pop()).sort()).toEqual(['hr', 'owner']);
    expect(hr[0]!.message.title).toBe('Document runs out: Staff One');
  });

  it('tells the manager, then HR, then the person about leave, and the person about violations', async () => {
    const boss = await prisma.employee.create({
      data: { userId: users.owner!, nameEn: 'Boss', nameAr: 'المدير' },
    });
    const staff = await prisma.employee.create({
      data: {
        userId: users.staff!,
        nameEn: 'Staff One',
        nameAr: 'موظف',
        homeStoreId: fx.store.id,
        managerId: boss.id,
      },
    });
    const type = await prisma.leaveType.create({
      data: { code: 'annual', nameEn: 'Annual leave', nameAr: 'اعتيادية', balance: 'annual' },
    });
    const request = await prisma.leaveRequest.create({
      data: {
        employeeId: staff.id,
        typeId: type.id,
        fromDay: new Date('2026-12-06T00:00:00Z'),
        toDay: new Date('2026-12-07T00:00:00Z'),
        days: 2,
        status: 'pending_manager',
        managerEmployeeId: boss.id,
        requestedById: users.staff!,
        createdAt: ago(2),
      },
    });
    await run();
    const asked = push.sent.filter((s) => s.message.tag === `leave-${request.id}`);
    expect(asked.map((s) => s.endpoint.split('/').pop())).toEqual(['owner']);
    expect(asked[0]!.message.title).toBe('Leave request from Staff One');
    expect(asked[0]!.message.url).toBe('/my-file/inbox');

    // The manager approves: HR (use, the store's) hears, and the person in Arabic.
    push.sent = [];
    await prisma.leaveRequest.update({
      where: { id: request.id },
      data: { status: 'pending_hr', managerDecidedAt: ago(1), managerDecidedById: users.owner },
    });
    await run();
    const next = push.sent.filter((s) => s.message.tag === `leave-${request.id}`);
    expect(next.map((s) => s.endpoint.split('/').pop()).sort()).toEqual(['hr', 'owner', 'staff']);
    expect(next.find((s) => s.endpoint.endsWith('staff'))!.message.title).toBe(
      'وافق مديرك على إجازتك',
    );
    // Running again sends nothing twice.
    push.sent = [];
    await run();
    expect(push.sent.filter((s) => s.message.tag === `leave-${request.id}`)).toEqual([]);

    const vtype = await prisma.violationType.create({
      data: {
        code: 'late_arrival',
        nameEn: 'Late arrival',
        nameAr: 'تأخير',
        category: 'attendance',
      },
    });
    const v = await prisma.violation.create({
      data: {
        employeeId: staff.id,
        typeId: vtype.id,
        occurredOn: new Date('2026-11-01T00:00:00Z'),
        description: 'Late',
        suggestedStep: 1,
        step: 1,
        penalty: 'written_warning',
        recordedById: users.hr!,
        recordedAt: ago(1),
      },
    });
    await run();
    const told = push.sent.filter((s) => s.message.tag === `violation-${v.id}`);
    expect(told.map((s) => s.endpoint.split('/').pop())).toEqual(['staff']);
    expect(told[0]!.message.url).toBe('/my-file/violations');
  });

  it('tells the sales managers about a website lead waiting in their queue', async () => {
    await prisma.alert.create({
      data: { type: 'site_lead', key: 'site_lead:x', data: { leadId: 'x', name: 'Mona Adel' } },
    });
    await run();
    const lead = push.sent.filter((s) => s.message.url === '/admin/sales/leads');
    expect(lead.map((s) => s.endpoint.split('/').pop()).sort()).toEqual(['owner']);
    expect(lead[0]!.message.body).toBe('Mona Adel asked for rates.');
  });

  it('tells store staff about shipments and transfers coming to them', async () => {
    const manifest = await prisma.inboundManifest.create({
      data: { darkStoreId: fx.other.id, merchantId: fx.merchant.id, reference: 'ASN-7' },
    });
    const transfer = await prisma.transfer.create({
      data: {
        reference: 'TR-0001',
        fromId: fx.other.id,
        toId: fx.store.id,
        status: 'in_transit',
        sentAt: ago(2),
      },
    });
    await run();
    const shipment = push.sent.filter((s) => s.message.url.includes(manifest.id));
    expect(shipment.map((s) => s.endpoint.split('/').pop()).sort()).toEqual([
      'otherStaff',
      'owner',
    ]);
    const trip = push.sent.filter((s) => s.message.url.includes(transfer.id));
    expect(trip.map((s) => s.endpoint.split('/').pop()).sort()).toEqual(['owner', 'staff']);
    expect(trip.find((s) => s.endpoint.endsWith('owner'))!.message.body).toBe(
      'Stock from Other is coming to Test.',
    );
  });

  it('tells the rider an order is theirs', async () => {
    const o = await order({ status: 'packed' });
    const rider = await prisma.rider.create({
      data: { userId: users.rider!, darkStoreId: fx.store.id, badgeCode: 'R-1' },
    });
    await prisma.delivery.create({
      data: { orderId: o.id, riderId: rider.id, status: 'picked_up', assignedAt: ago(1) },
    });
    await prisma.order.update({ where: { id: o.id }, data: { status: 'out_for_delivery' } });
    await run();
    const riderPush = push.sent.filter((s) => s.endpoint.endsWith('/rider'));
    expect(riderPush.map((s) => s.message)).toEqual([
      expect.objectContaining({ title: `Order ${o.number} is yours`, url: '/rider' }),
    ]);
  });

  it('asks finance for approvals and cash differences, never the person who asked', async () => {
    await setSetting(prisma, {
      key: 'finance.approval_threshold_piastres',
      value: 100_000,
      actorUserId: users.owner!,
    });
    await prisma.financeRequest.create({
      data: {
        kind: 'expense',
        amountPiastres: 250_050,
        payload: {},
        requestedById: users.finance!,
      },
    });
    await prisma.payout.create({
      data: {
        number: 7,
        merchantId: fx.merchant.id,
        cutoffAt: ago(60),
        amountPiastres: 500_000,
        createdById: users.approver!,
      },
    });
    await prisma.payout.create({
      data: {
        number: 8,
        merchantId: fx.merchant.id,
        cutoffAt: ago(60),
        amountPiastres: 500, // below the threshold: no second person needed
        createdById: users.approver!,
      },
    });
    const rider = await prisma.rider.create({
      data: { userId: users.rider!, darkStoreId: fx.store.id, badgeCode: 'R-1' },
    });
    await prisma.cashHandover.create({
      data: {
        number: 3,
        riderId: rider.id,
        darkStoreId: fx.store.id,
        expectedPiastres: 10_000,
        countedPiastres: 9_000,
        differencePiastres: 1_000,
        status: 'pending',
        receivedById: users.staff!,
        idempotencyKey: 'ch-3',
      },
    });
    await run();
    const by = (url: string) =>
      push.sent
        .filter((s) => s.message.url === url)
        .map((s) => `${s.endpoint.split('/').pop()}:${s.message.title}`)
        .sort();
    expect(by('/finance/approvals')).toEqual([
      'approver:Waiting for your approval',
      'owner:Waiting for your approval',
    ]);
    expect(by('/finance/payouts')).toEqual([
      'finance:Payout PAY-000007 to approve',
      'owner:Payout PAY-000007 to approve',
    ]);
    expect(by('/finance/cash')).toEqual([
      'approver:Cash difference CH-000003',
      'finance:Cash difference CH-000003',
      'owner:Cash difference CH-000003',
    ]);
    expect(push.sent.find((s) => s.message.url === '/finance/approvals')!.message.body).toBe(
      '2,500.50 EGP from finance needs a second person.',
    );
  });

  it('tells store managers and finance once about a rider holding cash too long', async () => {
    await person('manager', 'store_staff', {
      job: 'store_manager',
      stores: [fx.store.id],
    });
    await prisma.alert.create({
      data: {
        type: 'rider_cash_overdue',
        key: 'rider_cash_overdue:r1:2026-11-06',
        darkStoreId: fx.store.id,
        data: { riderId: 'r1', rider: 'Omar', amountEgp: '1,250.00', hours: 12 },
        createdAt: ago(1),
      },
    });
    await run();
    const by = (url: string) =>
      push.sent
        .filter((s) => s.message.url === url)
        .map((s) => s.endpoint.split('/').pop())
        .sort();
    expect(by(`/store/${fx.store.id}/cash`)).toEqual(['manager', 'owner']);
    expect(by('/finance/cash-position')).toEqual(['approver', 'finance']);
    expect(push.sent.find((s) => s.endpoint.endsWith('/finance'))!.message.body).toBe(
      'Omar at Test has held 1,250.00 EGP for over 12 h.',
    );
    push.sent = [];
    await run();
    expect(push.sent).toEqual([]);
  });

  it('tells the assignee about a new ticket and the other person about a reply', async () => {
    const ticket = await createTicket(prisma, {
      title: 'Fridge broken',
      body: 'Please send someone',
      assigneeId: users.ops!,
      priority: 'urgent',
      actorUserId: users.staff!,
      now: ago(3),
    });
    await run();
    expect(push.sent.map((s) => [s.endpoint.split('/').pop(), s.message.title])).toEqual([
      ['ops', 'Ticket TCK-000001: Fridge broken'],
    ]);
    push.sent = [];
    await addTicketMessage(prisma, {
      ticketId: ticket.id,
      body: 'On my way',
      authorId: users.ops!,
      authorName: 'ops',
      source: 'app',
      now: ago(1),
    });
    await run();
    expect(push.sent.map((s) => [s.endpoint.split('/').pop(), s.message.body])).toEqual([
      ['staff', 'ops: On my way'],
    ]);
    expect(push.sent[0]!.message.url).toBe(`/tickets/${ticket.id}`);
  });

  it('tells a person their day was closed as late', async () => {
    const employee = await prisma.employee.create({
      data: { userId: users.rider!, nameEn: 'Rider' },
    });
    await prisma.attendanceDay.create({
      data: {
        employeeId: employee.id,
        day: new Date('2026-11-19'),
        status: 'late',
        computedStatus: 'late',
        lateMinutes: 17,
        closedAt: ago(2),
      },
    });
    await run();
    expect(push.sent.map((s) => [s.endpoint.split('/').pop(), s.message.body])).toEqual([
      ['rider', 'You clocked in 17 min late on 2026-11-19.'],
    ]);
  });

  it('tells merchant users with the right about orders, payouts and low stock', async () => {
    const o = await order({ status: 'packed' });
    await prisma.notification.create({
      data: {
        merchantId: fx.merchant.id,
        type: 'order_delivered',
        data: { orderId: o.id, number: o.number },
        createdAt: ago(1),
      },
    });
    await prisma.payout.create({
      data: {
        number: 9,
        merchantId: fx.merchant.id,
        cutoffAt: ago(60),
        amountPiastres: 12_345,
        status: 'paid',
        paidAt: ago(1),
        createdById: users.approver!,
      },
    });
    await prisma.stockLevel.create({
      data: { darkStoreId: fx.store.id, skuId: fx.sku.id, onHand: 3, reserved: 1 },
    });
    await prisma.stockLevel.create({
      data: { darkStoreId: fx.store.id, skuId: fx.sku2.id, onHand: 50, reserved: 0 },
    });
    await run();
    const merchantSide = push.sent
      .filter((s) => s.message.url.startsWith('/merchant'))
      .map((s) => `${s.endpoint.split('/').pop()}:${s.message.title}`)
      .sort();
    expect(merchantSide).toEqual([
      `member:Order ${o.number} delivered`,
      'merchant:Low stock: SKU-1',
      `merchant:Order ${o.number} delivered`,
      'merchant:Payout PAY-000009 paid',
    ]);
    // The same low stock is told once a day.
    push.sent = [];
    await prisma.stockLevel.update({
      where: { darkStoreId_skuId: { darkStoreId: fx.store.id, skuId: fx.sku.id } },
      data: { reserved: 2 },
    });
    await run();
    expect(push.sent).toEqual([]);
  });

  it('removes devices that are gone and never fails on a broken one', async () => {
    push.gone.add('https://push.test/staff');
    push.failing.add('https://push.test/owner');
    const errors: unknown[] = [];
    await order({});
    const result = await dispatchPush(prisma, push, {
      now: NOW,
      onError: (e) => void errors.push(e),
    });
    expect(result).toMatchObject({ events: 1, gone: 1, failed: 1 });
    expect(errors).toHaveLength(1);
    expect(
      await prisma.pushSubscription.findUnique({ where: { endpoint: 'https://push.test/staff' } }),
    ).toBeNull();
    const owner = await prisma.pushSubscription.findUniqueOrThrow({
      where: { endpoint: 'https://push.test/owner' },
    });
    expect(owner.failures).toBe(1);
    expect(await prisma.pushSent.count()).toBe(1);
  });

  it('sends nothing without keys or with push.enabled at 0', async () => {
    await order({});
    push.enabled = false;
    expect(await run()).toMatchObject({ events: 0 });
    push.enabled = true;
    await setSetting(prisma, { key: 'push.enabled', value: 0, actorUserId: users.owner! });
    expect(await run()).toMatchObject({ events: 0 });
    const test = await notify(prisma, push, {
      key: 'test:1',
      userIds: [users.owner!],
      type: 'test',
      text: 'test',
      url: '/notifications',
      tag: 'test',
    });
    expect(test.status).toBe('off');
    expect(push.sent).toEqual([]);
  });
});
