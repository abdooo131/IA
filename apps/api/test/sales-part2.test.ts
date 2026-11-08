import type { INestApplication } from '@nestjs/common';
import { cairoDay, type JobRole } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, grantAccess, resetAndSeed } from './helpers';

/** Sales CRM part 2 (docs/SALES.md): proposals and their public link, numbers, commission. */
describe('sales CRM part 2', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let n = 0;
  const key = () => `sales2-key-${++n}-0000`;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetAndSeed(prisma);
  });

  const signIn = async (email: string, password: string) => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/login').send({ email, password }).expect(200);
    return agent;
  };
  const member = async (email: string, jobRole: JobRole) => {
    const user = await createUser(prisma, {
      email,
      name: email.split('@')[0],
      password: 'team-password-1',
      role: 'admin',
    });
    await prisma.userAccess.deleteMany({ where: { userId: user.id } });
    await grantAccess(prisma, user.id, jobRole);
    return { user, agent: await signIn(email, 'team-password-1') };
  };
  const addDeal = async (agent: request.Agent, brandName: string) =>
    (
      await agent
        .post('/sales/deals')
        .send({
          company: { brandName },
          contact: { name: 'Hana Brand', phone: '01012345678', email: 'hana@brand.eg' },
          expectedMonthlyOrders: 800,
          idempotencyKey: key(),
        })
        .expect(201)
    ).body.id as string;
  const propose = async (agent: request.Agent, dealId: string, extra: object = {}) =>
    (
      await agent
        .post('/sales/proposals')
        .send({ dealId, idempotencyKey: key(), noticeDays: 30, ...extra })
        .expect(201)
    ).body as { id: string; label: string; needsApproval: boolean };
  const pub = () => request(app.getHttpServer());

  it('lets the brand read, accept and decline through the public link only while it is open', async () => {
    const rep = await member('rep@test.eg', 'sales_rep');
    const dealId = await addDeal(rep.agent, 'Link Brand');
    const zoneId = (await prisma.zone.findFirst({ where: { isActive: true } }))?.id;
    // This app has no parcel network: the one route zone the proposal prices is made here.
    await prisma.pricingZone.upsert({
      where: { code: 'GC' },
      update: {},
      create: {
        code: 'GC',
        name: 'Greater Cairo',
        transitDays: 1,
        priceS: 5_000,
        priceM: 6_000,
        priceL: 7_500,
        priceXL: 10_000,
      },
    });
    const zones = (await rep.agent.get('/sales/price-zones').expect(200)).body;
    expect(zones.parcelZones.map((z: { code: string }) => z.code)).toContain('GC');
    // One proposal can quote both services: 60 minutes and next day parcels (Shiply).
    const draft = await propose(rep.agent, dealId, {
      averageOrderPiastres: 40_000,
      includesParcels: true,
      parcelDiscountBp: 500,
      parcelCodFeeBp: 75,
      // Every price in the agreement: next day by route zone and size, 60 minutes by zone.
      parcelPrices: [{ zoneCode: 'GC', size: 'M', pricePiastres: 5_500 }],
      zonePrices: zoneId ? [{ zoneId, pricePiastres: 3_000 }] : [],
    });
    const sent = await rep.agent.post(`/sales/proposals/${draft.id}/send`).expect(201);
    const token = sent.body.token as string;
    expect((await pub().get(`/proposal/${token}`).expect(200)).body.parcels).toEqual({
      discountBp: 500,
      codFeeBp: 75,
      returnFeeBp: null,
      prices: [{ zoneCode: 'GC', size: 'M', pricePiastres: 5_500 }],
    });
    expect(token).toMatch(/^[\w-]{32}$/);

    // No sign in needed; opening marks it viewed.
    const page = await pub().get(`/proposal/${token}`).expect(200);
    expect(page.body).toMatchObject({ status: 'viewed', brand: 'Link Brand' });
    expect(page.body).not.toHaveProperty('dealId');
    await pub().get('/proposal/not-a-real-token').expect(404);
    await pub()
      .post(`/proposal/${token}/accept`)
      .send({ signerName: 'H', signerTitle: '' })
      .expect(400);
    await pub()
      .post(`/proposal/${token}/accept`)
      .send({ signerName: 'Hana Brand', signerTitle: 'Founder' })
      .expect(201);
    // Accepting again changes nothing; declining now is refused.
    await pub()
      .post(`/proposal/${token}/accept`)
      .send({ signerName: 'Hana Brand', signerTitle: 'Founder' })
      .expect(201);
    expect(
      (await pub().post(`/proposal/${token}/decline`).send({ signerName: 'Hana' }).expect(409)).body
        .error,
    ).toBe('proposal_closed');

    // The rep confirms: merchant, owner and setup link; the owner chooses a password.
    const confirmed = await rep.agent
      .post(`/sales/proposals/${draft.id}/confirm`)
      .send({ ownerEmail: 'owner@linkbrand.eg' })
      .expect(201);
    const setup = confirmed.body.setupToken as string;
    expect((await pub().get(`/auth/setup/${setup}`).expect(200)).body).toMatchObject({
      email: 'owner@linkbrand.eg',
      merchant: 'Link Brand',
    });
    await pub().post(`/auth/setup/${setup}`).send({ password: 'short' }).expect(400);
    await pub().post(`/auth/setup/${setup}`).send({ password: 'owner-password-1' }).expect(201);
    await pub().post(`/auth/setup/${setup}`).send({ password: 'owner-password-2' }).expect(404);
    await signIn('owner@linkbrand.eg', 'owner-password-1');
    const deal = await rep.agent.get(`/sales/deals/${dealId}`).expect(200);
    expect(deal.body).toMatchObject({ stage: 'won', merchant: { name: 'Link Brand' } });
    // The contract it made holds the next day terms too.
    const version = await prisma.merchantContractVersion.findFirstOrThrow({
      where: { contract: { merchant: { name: 'Link Brand' } } },
    });
    expect(version).toMatchObject({
      parcelDiscountBp: 500,
      parcelCodFeeBp: 75,
      parcelReturnFeeBp: null,
    });
    // ... and both price lists.
    expect(
      await prisma.merchantContractVersionParcelPrice.findMany({
        where: { versionId: version.id },
        select: { zoneCode: true, size: true, pricePiastres: true },
      }),
    ).toEqual([{ zoneCode: 'GC', size: 'M', pricePiastres: 5_500 }]);
    if (zoneId)
      expect(
        await prisma.merchantContractVersionZonePrice.findMany({
          where: { versionId: version.id },
          select: { zoneId: true, pricePiastres: true },
        }),
      ).toEqual([{ zoneId, pricePiastres: 3_000 }]);
    expect(
      (
        await rep.agent
          .post(`/sales/deals/${dealId}/stage`)
          .send({ stage: 'lost', lostReason: 'price' })
          .expect(409)
      ).body.error,
    ).toBe('deal_won_locked');
  });

  it('refuses an expired link', async () => {
    const rep = await member('rep@test.eg', 'sales_rep');
    const dealId = await addDeal(rep.agent, 'Late Brand');
    const draft = await propose(rep.agent, dealId);
    const sent = await rep.agent.post(`/sales/proposals/${draft.id}/send`).expect(201);
    await prisma.crmProposal.update({
      where: { id: draft.id },
      data: { validUntil: new Date('2020-01-01T00:00:00Z') },
    });
    const res = await pub()
      .post(`/proposal/${sent.body.token}/accept`)
      .send({ signerName: 'Too Late', signerTitle: 'CEO' })
      .expect(409);
    expect(res.body.error).toBe('proposal_expired');
    expect((await pub().get(`/proposal/${sent.body.token}`).expect(200)).body.status).toBe(
      'expired',
    );
  });

  it('keeps a rep to their own proposals and leaves approvals and targets to managers', async () => {
    const a = await member('rep.a@test.eg', 'sales_rep');
    const b = await member('rep.b@test.eg', 'sales_rep');
    const boss = await member('boss@test.eg', 'sales_manager');
    const dealA = await addDeal(a.agent, 'Alpha');
    await addDeal(b.agent, 'Beta');
    // A big discount: the rep cannot send or approve it, another rep cannot see it.
    await prisma.setting.upsert({
      where: { key_scope: { key: 'fee.order_fixed_piastres', scope: 'global' } },
      update: { value: 2000 },
      create: { key: 'fee.order_fixed_piastres', scope: 'global', value: 2000, description: 'x' },
    });
    const draft = await propose(a.agent, dealA, { orderFixedPiastres: 1000 });
    expect(draft.needsApproval).toBe(true);
    expect((await a.agent.post(`/sales/proposals/${draft.id}/send`).expect(409)).body.error).toBe(
      'approval_required',
    );
    await a.agent.post(`/sales/proposals/${draft.id}/approve`).expect(403);
    expect((await b.agent.get(`/sales/deals/${dealA}/proposals`).expect(403)).body.error).toBe(
      'deal_not_allowed',
    );
    expect((await b.agent.get('/sales/proposals').expect(200)).body).toEqual([]);
    expect((await a.agent.get('/sales/proposals').expect(200)).body).toHaveLength(1);
    await a.agent.post(`/sales/proposals/${draft.id}/request-approval`).expect(201);
    const toApprove = await boss.agent.get('/sales/proposals?needsApproval=true').expect(200);
    expect(toApprove.body.map((p: { id: string }) => p.id)).toEqual([draft.id]);
    await boss.agent.post(`/sales/proposals/${draft.id}/approve`).expect(201);
    // Every price counts, and a price changed after approval is a new question: a next day
    // price 80% under its list price needs a manager again.
    const edited = await a.agent
      .patch(`/sales/proposals/${draft.id}`)
      .send({
        includesParcels: true,
        parcelPrices: [{ zoneCode: 'GC', size: 'M', pricePiastres: 1_000 }],
      })
      .expect(200);
    expect(edited.body.needsApproval).toBe(true);
    expect((await a.agent.post(`/sales/proposals/${draft.id}/send`).expect(409)).body.error).toBe(
      'approval_required',
    );
    await a.agent
      .patch(`/sales/proposals/${draft.id}`)
      .send({ includesParcels: false, parcelPrices: [] })
      .expect(200);
    await a.agent.post(`/sales/proposals/${draft.id}/request-approval`).expect(201);
    await boss.agent.post(`/sales/proposals/${draft.id}/approve`).expect(201);
    await a.agent.post(`/sales/proposals/${draft.id}/send`).expect(201);

    // Targets: managers set them; reps read only their own.
    const month = cairoDay(new Date()).slice(0, 7);
    await a.agent
      .post('/sales/targets')
      .send({ userId: a.user.id, month, dealsWon: 3, orders: 100, feeRevenuePiastres: 100_000 })
      .expect(403);
    await boss.agent
      .post('/sales/targets')
      .send({ userId: a.user.id, month, dealsWon: 3, orders: 100, feeRevenuePiastres: 100_000 })
      .expect(201);
    const mine = await a.agent.get(`/sales/targets?month=${month}`).expect(200);
    expect(mine.body.rows).toHaveLength(1);
    expect(mine.body.rows[0]).toMatchObject({ user: { id: a.user.id }, target: { dealsWon: 3 } });
    const all = await boss.agent.get(`/sales/targets?month=${month}`).expect(200);
    expect(all.body.rows.length).toBeGreaterThanOrEqual(3);
    // Each row carries the month's commission standing; managers see who has no fees target.
    expect(mine.body.rows[0].commission).toMatchObject({
      outcome: 'missed',
      revenuePiastres: 0,
      targetPiastres: 100_000,
      neededPiastres: 100_000,
      pending: [],
    });
    expect(mine.body.missingTargets).toEqual([]);
    const missingNow = all.body.missingTargets[0];
    expect(missingNow.month).toBe(month);
    const missingIds = missingNow.users.map((u: { id: string }) => u.id);
    expect(missingIds).toContain(b.user.id);
    expect(missingIds).not.toContain(a.user.id);
    await a.agent.get(`/sales/dashboard?month=${month}`).expect(200);
    expect((await a.agent.get('/sales/dashboard?month=2026-13').expect(400)).body.error).toBe(
      'invalid_month',
    );

    // Commission: a rep sees only theirs and never approves.
    const c = await prisma.crmCommission.create({
      data: {
        userId: a.user.id,
        month: '2026-10',
        computedPiastres: 5_000,
        amountPiastres: 5_000,
        idempotencyKey: `commission:${a.user.id}:2026-10`,
      },
    });
    expect((await b.agent.get('/sales/commissions').expect(200)).body.commissions).toEqual([]);
    expect((await a.agent.get('/sales/commissions').expect(200)).body.commissions).toHaveLength(1);
    await a.agent.post(`/sales/commissions/${c.id}/approve`).expect(403);
    await boss.agent
      .post(`/sales/commissions/${c.id}/adjust`)
      .send({ amountPiastres: 6_000, reason: '' })
      .expect(400);
    await boss.agent.post(`/sales/commissions/${c.id}/approve`).expect(201);
    // A missed month is kept closed at 0: nothing to approve or pay.
    const missed = await prisma.crmCommission.create({
      data: {
        userId: b.user.id,
        month: '2026-10',
        status: 'closed',
        outcome: 'missed',
        revenuePiastres: 90_000,
        targetPiastres: 100_000,
        computedPiastres: 0,
        amountPiastres: 0,
        idempotencyKey: `commission:${b.user.id}:2026-10`,
      },
    });
    expect((await b.agent.get('/sales/commissions').expect(200)).body.commissions).toEqual([
      expect.objectContaining({ status: 'closed', outcome: 'missed', targetPiastres: 100_000 }),
    ]);
    expect(
      (await boss.agent.post(`/sales/commissions/${missed.id}/approve`).expect(409)).body.error,
    ).toBe('commission_not_draft');
  });
});
