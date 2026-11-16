import type { INestApplication } from '@nestjs/common';
import { createOrder } from '@shiplynow/db';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, grantAccess, resetAndSeed } from './helpers';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
const DEMO = 'demo-password-1';

/** GET /photos/:id opens a file only for the people its record concerns. */
describe('who may open a stored file', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let stores: Map<string, string>;

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const userId = async (email: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
  const photo = (kind: 'pack' | 'delivery' | 'receipt' | 'basata_receipt', createdById?: string) =>
    prisma.photo.create({
      data: { kind, contentType: 'image/jpeg', data: JPEG, sizeBytes: JPEG.length, createdById },
    });
  /** Asserts which of the signed in people may open the file (200) and which get 404. */
  const check = async (id: string, people: Record<string, boolean>) => {
    for (const [email, allowed] of Object.entries(people)) {
      const a = await agent(email, email === 'admin@test.eg' ? 'admin-password-1' : DEMO);
      const res = await a.get(`/photos/${id}`);
      expect({ email, status: res.status }).toEqual({ email, status: allowed ? 200 : 404 });
      if (!allowed) expect(res.body.error).toBe('photo_not_found');
    }
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    ({ stores } = await resetAndSeed(prisma));
    const hr = await createUser(prisma, { email: 'hr@test.eg', password: DEMO, role: 'admin' });
    await grantAccess(prisma, hr.id, 'hr_officer');
  });

  const placeOrder = async () => {
    const ncr = stores.get('NCR')!;
    const level = await prisma.stockLevel.findFirstOrThrow({
      where: { darkStoreId: ncr, onHand: { gt: 0 } },
      include: { sku: true },
    });
    const zone = await prisma.zone.findFirstOrThrow({ where: { darkStoreId: ncr } });
    return createOrder(prisma, {
      merchantId: level.sku.merchantId,
      darkStoreId: ncr,
      zoneId: zone.id,
      source: 'manual',
      customerName: 'Photo Test',
      customerPhone: '01012345678',
      addressText: 'Test street',
      paymentMethod: 'prepaid',
      deliveryFeePiastres: 0,
      items: [{ skuId: level.skuId, quantity: 1 }],
      actorUserId: await userId('admin@test.eg'),
    });
  };

  it('opens pack and delivery proof for the order store, its rider and its merchant', async () => {
    const order = await placeOrder();
    const pack = await photo('pack');
    const proof = await photo('delivery');
    await prisma.order.update({ where: { id: order.id }, data: { packPhotoId: pack.id } });
    const rider = await prisma.rider.findFirstOrThrow({
      where: { user: { email: 'rider.newcairo@shiplynow.local' } },
    });
    await prisma.delivery.create({
      data: { orderId: order.id, riderId: rider.id, proofPhotoId: proof.id },
    });
    const people = {
      'admin@test.eg': true,
      'staff.newcairo@shiplynow.local': true,
      'staff.maadi@shiplynow.local': false,
      'merchant@evechantelle.example': true,
      'rider.newcairo@shiplynow.local': true,
      'rider.maadi@shiplynow.local': false,
      'hr@test.eg': false,
    };
    await check(pack.id, people);
    await check(proof.id, people);
  });

  it('keeps finance files to accounting and the uploader', async () => {
    const mine = await photo('receipt', await userId('staff.maadi@shiplynow.local'));
    await check(mine.id, {
      'staff.maadi@shiplynow.local': true,
      'finance@shiplynow.local': true,
      'admin@test.eg': true,
      'staff.newcairo@shiplynow.local': false,
      'merchant@evechantelle.example': false,
      'rider.newcairo@shiplynow.local': false,
      'hr@test.eg': false,
    });
  });

  it('opens a petty cash receipt for staff of its store', async () => {
    const receipt = await photo('receipt');
    const account = await prisma.ledgerAccount.findFirstOrThrow();
    await prisma.pettyCashExpense.create({
      data: {
        number: 1,
        darkStoreId: stores.get('NCR')!,
        expenseAccountId: account.id,
        amountPiastres: 1000,
        note: 'Tape',
        photoId: receipt.id,
        idempotencyKey: 'pc-photo-test',
        createdById: await userId('admin@test.eg'),
      },
    });
    await check(receipt.id, {
      'staff.newcairo@shiplynow.local': true,
      'finance@shiplynow.local': true,
      'staff.maadi@shiplynow.local': false,
      'merchant@evechantelle.example': false,
      'hr@test.eg': false,
    });
  });

  it('opens a Basata receipt for its own rider and accounting only', async () => {
    const receipt = await photo('basata_receipt');
    const rider = await prisma.rider.findFirstOrThrow({
      where: { user: { email: 'rider.newcairo@shiplynow.local' } },
    });
    await prisma.basataDeposit.create({
      data: {
        number: 1,
        riderId: rider.id,
        darkStoreId: rider.darkStoreId,
        amountPiastres: 5000,
        reference: 'BAS-1',
        depositedAt: new Date(),
        photoId: receipt.id,
        deadlineDay: new Date('2026-11-16'),
        idempotencyKey: 'basata-photo-test',
      },
    });
    await check(receipt.id, {
      'rider.newcairo@shiplynow.local': true,
      'finance@shiplynow.local': true,
      'rider.maadi@shiplynow.local': false,
      'staff.newcairo@shiplynow.local': false,
      'hr@test.eg': false,
    });
  });

  it('opens an expense claim receipt for the claimant and their manager', async () => {
    const receipt = await photo('receipt');
    const claimant = await prisma.employee.findUniqueOrThrow({
      where: { userId: await userId('staff.newcairo@shiplynow.local') },
    });
    const manager = await prisma.employee.findUniqueOrThrow({
      where: { userId: await userId('staff.maadi@shiplynow.local') },
    });
    const account = await prisma.ledgerAccount.findFirstOrThrow();
    await prisma.expenseClaim.create({
      data: {
        number: 1,
        employeeId: claimant.id,
        userId: claimant.userId,
        expenseAccountId: account.id,
        amountPiastres: 1000,
        paidOn: new Date('2026-11-15'),
        note: 'Taxi',
        photoId: receipt.id,
        managerEmployeeId: manager.id,
        idempotencyKey: 'claim-photo-test',
      },
    });
    await check(receipt.id, {
      'staff.newcairo@shiplynow.local': true,
      'staff.maadi@shiplynow.local': true,
      'finance@shiplynow.local': true,
      'rider.newcairo@shiplynow.local': false,
      'hr@test.eg': false,
    });
  });

  it('answers 404 for an unknown id', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const res = await admin.get('/photos/nope').expect(404);
    expect(res.body.error).toBe('photo_not_found');
  });
});
