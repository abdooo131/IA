import type { INestApplication } from '@nestjs/common';
import { createOrder, FakeFileStore, savePhoto } from '@shiplynow/db';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, grantAccess, resetAndSeed } from './helpers';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
const PDF = Buffer.from('%PDF-1.4\n% a signed file\n%%EOF');
const DEMO = 'demo-password-1';

/** Reads a binary answer as a Buffer. */
const binary = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

/**
 * Every file route works the same with the files in the database (no R2) and in R2 (here the
 * FakeFileStore): the bytes, content type and download name are the same, and the access checks
 * in front of them do not change.
 */
describe.each([
  ['database', null],
  ['R2', new FakeFileStore()],
] as const)('files kept in the %s', (where, store) => {
  let app: INestApplication;
  let prisma: PrismaService;
  let stores: Map<string, string>;

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const admin = () => agent('admin@test.eg', 'admin-password-1');
  const userId = async (email: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
  const expectedStorage = store ? 'r2' : 'db';

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp(store ? { files: store } : {}));
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    ({ stores } = await resetAndSeed(prisma));
  });

  it(`uploads a proof photo to the ${where} and opens it only for the order's people`, async () => {
    const staff = await agent('staff.newcairo@shiplynow.local');
    const up = await staff
      .post('/photos?kind=pack')
      .set('content-type', 'image/jpeg')
      .send(JPEG)
      .expect(201);
    const row = await prisma.photo.findUniqueOrThrow({ where: { id: up.body.id } });
    expect(row.storage).toBe(expectedStorage);
    expect(row.data === null).toBe(Boolean(store));
    if (store) expect(store.objects.has(row.storageKey!)).toBe(true);

    // Linked to an order of the New Cairo store.
    const ncr = stores.get('NCR')!;
    const level = await prisma.stockLevel.findFirstOrThrow({
      where: { darkStoreId: ncr, onHand: { gt: 0 } },
      include: { sku: true },
    });
    const zone = await prisma.zone.findFirstOrThrow({ where: { darkStoreId: ncr } });
    const order = await createOrder(prisma, {
      merchantId: level.sku.merchantId,
      darkStoreId: ncr,
      zoneId: zone.id,
      source: 'manual',
      customerName: 'File Test',
      customerPhone: '01012345678',
      addressText: 'Test street',
      paymentMethod: 'prepaid',
      deliveryFeePiastres: 0,
      items: [{ skuId: level.skuId, quantity: 1 }],
      actorUserId: await userId('admin@test.eg'),
    });
    await prisma.order.update({ where: { id: order.id }, data: { packPhotoId: row.id } });
    const people = {
      'staff.newcairo@shiplynow.local': true,
      'merchant@evechantelle.example': true,
      'staff.maadi@shiplynow.local': false,
      'rider.maadi@shiplynow.local': false,
    };
    for (const [email, allowed] of Object.entries(people)) {
      const res = await (await agent(email)).get(`/photos/${row.id}`).buffer(true).parse(binary);
      expect({ email, status: res.status }).toEqual({ email, status: allowed ? 200 : 404 });
      if (allowed) {
        expect(res.headers['content-type']).toBe('image/jpeg');
        expect((res.body as Buffer).equals(JPEG)).toBe(true);
      }
    }
  });

  it('keeps a finance receipt with its own name, opened for accounting only', async () => {
    const finance = await agent('finance@shiplynow.local');
    const up = await finance
      .post('/finance/files?name=bill.pdf')
      .set('content-type', 'application/pdf')
      .send(PDF);
    expect(up.status).toBe(201);
    const row = await prisma.photo.findUniqueOrThrow({ where: { id: up.body.id } });
    expect(row.storage).toBe(expectedStorage);
    const res = await finance.get(`/photos/${row.id}`).buffer(true).parse(binary).expect(200);
    expect(res.headers['content-disposition']).toBe("inline; filename*=UTF-8''bill.pdf");
    expect((res.body as Buffer).equals(PDF)).toBe(true);
    await (await agent('merchant@evechantelle.example')).get(`/photos/${row.id}`).expect(404);
  });

  it('stores HR documents and photos, read back only inside HR scope', async () => {
    const hr = await admin();
    const rider = await prisma.employee.findFirstOrThrow({
      where: { user: { email: 'rider.maadi@shiplynow.local' } },
    });
    const doc = (
      await hr
        .post(`/hr/employees/${rider.id}/documents?typeId=doctype_national_id&expiresOn=2031-01-01`)
        .set('content-type', 'application/pdf')
        .send(PDF)
        .expect(201)
    ).body;
    const stored = await prisma.employeeDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect(stored.storage).toBe(expectedStorage);
    const opened = await hr
      .get(`/hr/employees/${rider.id}/documents/${doc.id}?download=1`)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(opened.headers['content-type']).toBe('application/pdf');
    expect(opened.headers['content-disposition']).toBe('attachment; filename="national_id-v1.pdf"');
    expect((opened.body as Buffer).equals(PDF)).toBe(true);

    await hr
      .put(`/hr/employees/${rider.id}/photo`)
      .set('content-type', 'image/jpeg')
      .send(JPEG)
      .expect(200);
    expect(
      (await prisma.employeePhoto.findUniqueOrThrow({ where: { employeeId: rider.id } })).storage,
    ).toBe(expectedStorage);
    const photo = await hr
      .get(`/hr/employees/${rider.id}/photo`)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect((photo.body as Buffer).equals(JPEG)).toBe(true);

    // People without HR access still cannot open them.
    const ops = await createUser(prisma, { email: 'ops@test.eg', password: DEMO, role: 'admin' });
    await grantAccess(prisma, ops.id, 'operations_manager');
    const outsider = await agent('ops@test.eg');
    await outsider.get(`/hr/employees/${rider.id}/documents/${doc.id}`).expect(403);
    await outsider.get(`/hr/employees/${rider.id}/photo`).expect(403);
  });

  it('keeps a signed contract copy, opened by contract readers', async () => {
    const merchant = await prisma.merchant.findFirstOrThrow({ where: { name: 'Eve Chantelle' } });
    await prisma.merchantContract.upsert({
      where: { merchantId: merchant.id },
      create: { merchantId: merchant.id, number: 900 },
      update: {},
    });
    const a = await admin();
    const up = await a
      .post(`/admin/merchants/${merchant.id}/contract/files?name=signed.pdf`)
      .set('content-type', 'application/pdf')
      .send(PDF)
      .expect(201);
    expect(
      (await prisma.merchantContractFile.findUniqueOrThrow({ where: { id: up.body.id } })).storage,
    ).toBe(expectedStorage);
    const opened = await a
      .get(`/admin/merchants/${merchant.id}/contract/files/${up.body.id}`)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(opened.headers['content-disposition']).toBe('inline; filename="signed.pdf"');
    expect((opened.body as Buffer).equals(PDF)).toBe(true);
    await (
      await agent('staff.maadi@shiplynow.local')
    )
      .get(`/admin/merchants/${merchant.id}/contract/files/${up.body.id}`)
      .expect(403);
  });

  it('shows where files are kept to settings managers only', async () => {
    await savePhoto(prisma, {
      kind: 'pack',
      contentType: 'image/jpeg',
      data: JPEG,
      actorUserId: null,
    });
    const status = (await (await admin()).get('/admin/files/status').expect(200)).body;
    expect(status).toMatchObject({
      store: expectedStorage,
      moveEnabled: true,
      inDatabase: store ? 0 : 1,
      inR2: store ? 1 : 0,
    });
    await (await agent('finance@shiplynow.local')).get('/admin/files/status').expect(403);
  });
});
