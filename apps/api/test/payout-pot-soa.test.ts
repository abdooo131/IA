import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { post } from '@shiplynow/db';
import { cairoDay } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, grantAccess, resetAndSeed, SLIP_PDF } from './helpers';

// Payout statement of account (SOA), proof of transfer (POT) and payout checks, through the
// API: finance uploads the slip, a second person ticks, a third marks paid; the merchant sees
// the SOA and the POT side by side and only for their own payouts.

const today = cairoDay(new Date());

describe('payout statement of account and proof of transfer', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let merchantId: string;

  const agent = async (email: string, password: string) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const owe = (id: string, amount: number) =>
    post(prisma, {
      kind: 'cod_collected',
      idempotencyKey: `cod-${randomUUID()}`,
      lines: [
        { account: { type: 'bank' }, amount },
        { account: { type: 'merchant', merchantId: id }, amount: -amount },
      ],
    });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    const seeded = await resetAndSeed(prisma);
    merchantId = seeded.merchantId;
  });

  it('freezes the SOA, needs the POT and a second person, and shows both to the merchant', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    await createUser(prisma, { email: 'viewer@test.eg', password: 'viewer-password-1', role: 'finance' });
    const viewer = await agent('viewer@test.eg', 'viewer-password-1');
    const clerkUser = await createUser(prisma, {
      email: 'clerk@test.eg',
      password: 'clerk-password-1',
      role: 'finance',
    });
    await grantAccess(prisma, clerkUser.id, 'finance_officer');
    const clerk = await agent('clerk@test.eg', 'clerk-password-1');
    const merchant = await agent('merchant@evechantelle.example', 'demo-password-1');

    await owe(merchantId, 42_500);
    const payout = await admin
      .post('/finance/payouts')
      .send({ merchantId, cutoffDay: today })
      .expect(201);
    const id = payout.body.id as string;
    expect(payout.body.amountPiastres).toBe(42_500);

    const soa = await admin.get(`/finance/payouts/${id}/statement`).expect(200);
    expect(soa.body).toMatchObject({
      number: 'SOA-000001',
      netPiastres: 42_500,
      closingPiastres: 42_500,
      byKind: { cod_collected: 42_500 },
    });
    const pdf = await admin
      .get(`/finance/payouts/${id}/statement.pdf?lang=ar`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    const csv = await admin.get(`/finance/payouts/${id}/statement.csv`).expect(200);
    expect(csv.text).toContain('net_to_transfer');

    // No proof yet.
    const refused = await admin.post(`/finance/payouts/${id}/paid`).send({}).expect(409);
    expect(refused.body.error).toBe('pot_required');
    const upload = (amount: number, type = 'application/pdf', body: Buffer = SLIP_PDF) =>
      clerk
        .post(`/finance/payouts/${id}/proof?name=slip.pdf&amountPiastres=${amount}&reference=CIB-9001`)
        .set('content-type', type)
        .send(body);
    expect((await upload(42_000).expect(409)).body.error).toBe('pot_amount_mismatch');
    await upload(42_500, 'text/plain', Buffer.from('not a slip')).expect(400);
    expect((await upload(42_500).expect(201)).body).toMatchObject({
      number: 'POT-000001',
      reference: 'CIB-9001',
    });
    const file = await admin.get(`/finance/payouts/${id}/proof`).expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');

    let controls = await admin.get(`/finance/payouts/${id}/controls`).expect(200);
    expect(controls.body).toMatchObject({ matches: true, blockers: ['checks_incomplete'] });
    const check = controls.body.checks.find(
      (c: { code: string }) => c.code === 'second_person_viewed',
    );
    expect((await admin.post(`/finance/payouts/${id}/paid`).send({}).expect(409)).body.error).toBe(
      'checks_incomplete',
    );
    await viewer.post(`/finance/payouts/${id}/checks/${check.id}`).send({ note: 'Seen' }).expect(201);
    // The second person may not pay it themself.
    controls = await viewer.get(`/finance/payouts/${id}/controls`).expect(200);
    expect(controls.body.blockers).toEqual(['same_person']);
    expect((await viewer.post(`/finance/payouts/${id}/paid`).send({}).expect(403)).body.error).toBe(
      'same_person',
    );
    await admin.post(`/finance/payouts/${id}/paid`).send({}).expect(201);
    expect((await prisma.payout.findUniqueOrThrow({ where: { id } })).reference).toBe('CIB-9001');

    const doc = await admin.get(`/finance/documents/payout/${id}`).expect(200);
    expect(doc.body.data).toMatchObject({ hasStatement: true, hasProof: true, matches: true });

    // The merchant sees the SOA and the POT side by side, and that they match.
    const wallet = await merchant.get('/merchant/finance').expect(200);
    expect(wallet.body.payouts[0]).toMatchObject({
      id,
      status: 'paid',
      soa: { number: 'SOA-000001', netPiastres: 42_500 },
      pot: { number: 'POT-000001', amountPiastres: 42_500, reference: 'CIB-9001' },
      matches: true,
    });
    await merchant.get(`/merchant/finance/payouts/${id}/statement`).expect(200);
    await merchant.get(`/merchant/finance/payouts/${id}/statement.pdf`).expect(200);
    await merchant.get(`/merchant/finance/payouts/${id}/statement.csv`).expect(200);
    const slip = await merchant.get(`/merchant/finance/payouts/${id}/proof`).expect(200);
    expect(slip.headers['content-type']).toBe('application/pdf');

    // Another merchant's payout is not found for this merchant.
    const other = await prisma.merchant.create({ data: { name: 'Someone else' } });
    await owe(other.id, 9_000);
    const theirs = await admin
      .post('/finance/payouts')
      .send({ merchantId: other.id, cutoffDay: today })
      .expect(201);
    await merchant.get(`/merchant/finance/payouts/${theirs.body.id}/statement`).expect(404);
    await merchant.get(`/merchant/finance/payouts/${theirs.body.id}/statement.pdf`).expect(404);
    await merchant.get(`/merchant/finance/payouts/${theirs.body.id}/proof`).expect(404);
    // Before payment a merchant does not get the proof of their own payout, and never reads
    // the finance routes.
    await owe(merchantId, 9_000);
    const next = await admin
      .post('/finance/payouts')
      .send({ merchantId, cutoffDay: today })
      .expect(201);
    await clerk
      .post(`/finance/payouts/${next.body.id}/proof?name=s.pdf&amountPiastres=9000&reference=CIB-2`)
      .set('content-type', 'application/pdf')
      .send(SLIP_PDF)
      .expect(201);
    await merchant.get(`/merchant/finance/payouts/${next.body.id}/statement`).expect(200);
    await merchant.get(`/merchant/finance/payouts/${next.body.id}/proof`).expect(404);
    const waiting = await merchant.get('/merchant/finance').expect(200);
    expect(
      waiting.body.payouts.find((p: { id: string }) => p.id === next.body.id),
    ).toMatchObject({ status: 'draft', soa: { number: 'SOA-000003' }, pot: null });
    await merchant.get(`/finance/payouts/${next.body.id}/controls`).expect(403);
  });

  it('lets accounting manage edit the checks, and others only tick them', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const clerkUser = await createUser(prisma, {
      email: 'clerk@test.eg',
      password: 'clerk-password-1',
      role: 'finance',
    });
    await grantAccess(prisma, clerkUser.id, 'finance_officer');
    const clerk = await agent('clerk@test.eg', 'clerk-password-1');
    const body = {
      code: 'iban_matches',
      labelEn: 'IBAN on the slip is the merchant IBAN',
      labelAr: 'رقم الحساب في الإيصال هو حساب التاجر',
    };
    await clerk.post('/finance/payout-checks').send(body).expect(403);
    const created = await admin.post('/finance/payout-checks').send(body).expect(201);
    const list = await clerk.get('/finance/payout-checks').expect(200);
    expect(list.body.map((c: { code: string }) => c.code)).toEqual([
      'second_person_viewed',
      'iban_matches',
    ]);
    const system = list.body[0];
    expect(
      (await admin.patch(`/finance/payout-checks/${system.id}`).send({ active: false }).expect(409))
        .body.error,
    ).toBe('check_is_system');
    await clerk.patch(`/finance/payout-checks/${created.body.id}`).send({ active: false }).expect(403);
    await admin
      .patch(`/finance/payout-checks/${created.body.id}`)
      .send({ active: false })
      .expect(200);

    // The custom check, while active, is ticked by anyone with accounting use (the payer too).
    await admin.patch(`/finance/payout-checks/${created.body.id}`).send({ active: true }).expect(200);
    await owe(merchantId, 5_000);
    const payout = await admin
      .post('/finance/payouts')
      .send({ merchantId, cutoffDay: today })
      .expect(201);
    await clerk.post(`/finance/payouts/${payout.body.id}/checks/${created.body.id}`).send({}).expect(201);
    const controls = await clerk.get(`/finance/payouts/${payout.body.id}/controls`).expect(200);
    expect(controls.body.checks).toMatchObject([
      { code: 'second_person_viewed', mark: null },
      { code: 'iban_matches', mark: { by: 'clerk@test.eg', mine: true } },
    ]);
    expect(
      await prisma.auditLog.count({ where: { action: 'finance.payout_check_create' } }),
    ).toBe(1);
  });
});
