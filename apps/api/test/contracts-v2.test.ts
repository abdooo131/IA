import type { INestApplication } from '@nestjs/common';
import { cairoDay } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetAndSeed } from './helpers';

let n = 0;
const key = () => `cv2-${++n}-${Date.now()}`;

/** Reads a binary answer (a PDF) as a Buffer. */
const binary = (res: request.Response, done: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

const BODY = {
  orderFixedPiastres: 1_800,
  orderPercentBp: null,
  codPercentBp: 80,
  failedDeliveryPiastres: null,
  receivingPerUnitPiastres: 40,
  storagePerUnitMonthPiastres: null,
  returnPerUnitPiastres: null,
  payoutSchedule: 'twice_weekly',
  minimumPayoutPiastres: 50_000,
  promiseMinutes: 60,
  deliveryAttempts: 3,
  minimumMonthlyFeePiastres: null,
  securityDepositPiastres: 200_000,
  creditLimitPiastres: null,
  storeIds: [],
  coverageNote: 'New Cairo and Maadi',
  terms: 'Packaging is included. شروط خاصة للتاجر.',
  internalNote: 'Owner asked for twice weekly payouts',
  noticeDays: 30,
  endDate: null,
  tiers: [
    { fromOrder: 201, fixedFeePiastres: 1_500, codPercentBp: 60, storagePerUnitMonthPiastres: 0 },
  ],
};

describe('merchant contracts v2 end to end', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const agent = async (email: string, password = 'demo-password-1') => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const merchantId = async () =>
    (await prisma.merchant.findFirstOrThrow({ where: { name: { contains: 'Eve' } } })).id;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetAndSeed(prisma);
  });

  it('writes, activates, files and prints a contract; the merchant reads only their own', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const finance = await agent('finance@shiplynow.local');
    const merchant = await agent('merchant@evechantelle.example');
    const staff = await agent('staff.newcairo@shiplynow.local');
    const mid = await merchantId();
    const today = cairoDay(new Date());

    // The merchant page's overview.
    const overview = await admin.get(`/admin/merchants/${mid}/overview`).expect(200);
    expect(overview.body).toMatchObject({ merchant: { id: mid }, onboarding: { products: true } });
    await staff.get(`/admin/merchants/${mid}/overview`).expect(403);

    // No contract yet: standard prices.
    const empty = await admin.get(`/admin/merchants/${mid}/contract`).expect(200);
    expect(empty.body).toMatchObject({ contract: null, current: null });
    const draft = await admin
      .post(`/admin/merchants/${mid}/contract/versions`)
      .send({ ...BODY, startDate: today, idempotencyKey: key() })
      .expect(201);
    expect(draft.body.version).toBe(1);
    // Changing a draft, then activating it from today.
    await admin
      .put(`/admin/merchants/${mid}/contract/versions/${draft.body.id}`)
      .send({ ...BODY, startDate: today, orderFixedPiastres: 1_700 })
      .expect(200);
    await admin
      .post(`/admin/merchants/${mid}/contract/versions/${draft.body.id}/activate`)
      .send({ effectiveFrom: '2020-01-01' })
      .expect(400);
    const active = await admin
      .post(`/admin/merchants/${mid}/contract/versions/${draft.body.id}/activate`)
      .send({ effectiveFrom: today })
      .expect(201);
    expect(active.body.contract.label).toBe('CTR-000001');
    expect(active.body.current).toMatchObject({
      label: 'CTR-000001 v1',
      displayStatus: 'in_force',
      prices: { orderFixedPiastres: 1_700, codPercentBp: 80, orderPercentBp: null },
    });
    // The agreed schedule is set on the merchant when it takes effect.
    expect((await prisma.merchant.findUniqueOrThrow({ where: { id: mid } })).payoutSchedule).toBe(
      'twice_weekly',
    );
    await admin
      .put(`/admin/merchants/${mid}/contract/versions/${draft.body.id}`)
      .send({ ...BODY, startDate: today })
      .expect(409);

    // A signed copy, kept and opened again; the wrong kind of file is refused.
    const pdfFile = Buffer.from('%PDF-1.4\nsigned contract\n%%EOF');
    const upload = await admin
      .post(`/admin/merchants/${mid}/contract/files?name=signed.pdf&versionId=${draft.body.id}`)
      .set('content-type', 'application/pdf')
      .send(pdfFile)
      .expect(201);
    await admin
      .post(`/admin/merchants/${mid}/contract/files?name=fake.pdf`)
      .set('content-type', 'application/pdf')
      .send(Buffer.from('hello'))
      .expect(400);
    await finance
      .post(`/admin/merchants/${mid}/contract/files?name=signed.pdf`)
      .set('content-type', 'application/pdf')
      .send(pdfFile)
      .expect(403);
    const opened = await finance
      .get(`/admin/merchants/${mid}/contract/files/${upload.body.id}`)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect((opened.body as Buffer).equals(pdfFile)).toBe(true);

    // The printed contract in both languages.
    for (const lang of ['en', 'ar'])
      for (const who of [admin, finance]) {
        const pdf = await who
          .get(`/admin/merchants/${mid}/contract/pdf?lang=${lang}`)
          .buffer(true)
          .parse(binary)
          .expect(200);
        expect(pdf.headers['content-type']).toBe('application/pdf');
        expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
        expect(pdf.headers['content-disposition']).toContain(`CTR-000001-v1-${lang}.pdf`);
      }
    await staff.get(`/admin/merchants/${mid}/contract/pdf`).expect(403);

    // The merchant: read only, their own, without the team's note or files.
    const mine = await merchant.get('/merchant/contract').expect(200);
    expect(mine.body.current).toMatchObject({ internalNote: null, terms: BODY.terms });
    expect(mine.body.files).toEqual([]);
    expect(mine.body.draft).toBeNull();
    for (const lang of ['en', 'ar']) {
      const pdf = await merchant
        .get(`/merchant/contract/pdf?lang=${lang}`)
        .buffer(true)
        .parse(binary)
        .expect(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
    }
    await merchant.get(`/admin/merchants/${mid}/contract`).expect(403);
    await merchant.post(`/admin/merchants/${mid}/contract/versions`).send(BODY).expect(403);
    // Another merchant's contract is never reached through the merchant area.
    const other = await prisma.merchant.create({ data: { name: 'Other brand' } });
    await merchant.get(`/admin/merchants/${other.id}/contract/pdf`).expect(403);

    // The payout bank account is edited from the contract by merchants manage only.
    await finance
      .put(`/admin/merchants/${mid}/bank`)
      .send({ bankName: 'CIB', beneficiaryName: 'Eve' })
      .expect(403);
    const bank = await admin
      .put(`/admin/merchants/${mid}/bank`)
      .send({ bankName: 'CIB', beneficiaryName: 'Eve Chantelle' })
      .expect(200);
    expect(bank.body).toMatchObject({ bankName: 'CIB' });

    // A merchant's own fee setting no longer exists: the contract holds it.
    const refused = await admin
      .put('/admin/settings')
      .send({ key: 'fee.order_fixed_piastres', scope: `merchant:${mid}`, value: 100 })
      .expect(400);
    expect(refused.body.error).toBe('scope_not_allowed');

    // History lists the contract's changes.
    const audit = await prisma.auditLog.findMany({
      where: { entityType: 'merchant_contract', entityId: mid },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual([
      'merchant.contract_create',
      'merchant.contract_draft',
      'merchant.contract_draft_update',
      'merchant.contract_activate',
      'merchant.contract_file_add',
    ]);
  });
});
