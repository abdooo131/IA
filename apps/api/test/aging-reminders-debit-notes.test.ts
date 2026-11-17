import type { INestApplication } from '@nestjs/common';
import { post } from '@shiplynow/db';
import { addDays, cairoDay, cairoDayStart } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JobsService } from '../src/jobs/jobs.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, createUser, grantAccess, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';
let n = 0;
const key = () => `aging-api-${++n}-${Date.now()}`;

describe('aging reports, payment reminders and debit notes', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const fee = (merchantId: string, amount: number, at: Date) =>
    post(prisma, {
      kind: 'order_fee',
      idempotencyKey: key(),
      occurredAt: at,
      lines: [
        { account: { type: 'merchant', merchantId }, amount },
        { account: { type: 'revenue' }, amount: -amount },
      ],
    });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetAndSeed(prisma);
  });

  it('shows who owes us by age to accounting view, and reminders need accounting use', async () => {
    const today = cairoDay(new Date());
    const owing = await prisma.merchant.create({
      data: { name: 'Owing Merchant', billingEmails: ['pay@owing.eg'] },
    });
    await fee(owing.id, 7_000, new Date(cairoDayStart(addDays(today, -40)).getTime() + 3600_000));
    await fee(owing.id, 3_000, new Date(cairoDayStart(today).getTime() + 3600_000));

    const viewer = await createUser(prisma, {
      email: 'viewer@test.eg',
      password: DEMO,
      role: 'finance',
    });
    await grantAccess(prisma, viewer.id, 'accountant');
    const accountant = await agent('viewer@test.eg');
    const finance = await agent('finance@shiplynow.local');
    const staff = await agent('staff.newcairo@shiplynow.local');

    const report = (
      await accountant.get('/finance/aging/receivables').query({ q: 'owing' }).expect(200)
    ).body;
    expect(report.asOf).toBe(today);
    expect(report.merchants).toHaveLength(1);
    expect(report.merchants[0]).toMatchObject({
      merchantId: owing.id,
      balancePiastres: 10_000,
      buckets: { current: 3_000, d31_60: 7_000 },
      reminders: { count: 0 },
    });
    // As of an earlier day only what was booked by then.
    const before = (
      await accountant
        .get('/finance/aging/receivables')
        .query({ q: 'owing', day: addDays(today, -1) })
        .expect(200)
    ).body;
    expect(before.merchants[0]).toMatchObject({ balancePiastres: 7_000 });
    await accountant.get('/finance/aging/receivables').query({ day: '2026-02-30' }).expect(400);
    const pdf = await accountant
      .get('/finance/aging/receivables/export.pdf')
      .query({ lang: 'ar' })
      .expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(
      (await accountant.get('/finance/aging/payables').expect(200)).body.total.total,
    ).toBeGreaterThanOrEqual(0);
    expect(
      (await accountant.get('/finance/aging/payables/export.pdf').query({ lang: 'en' }).expect(200))
        .headers['content-type'],
    ).toBe('application/pdf');
    await staff.get('/finance/aging/receivables').expect(403);
    await staff.get('/finance/aging/payables').expect(403);

    // Send reminder now: accounting use; read only people cannot.
    await accountant
      .post(`/finance/receivables/${owing.id}/remind`)
      .send({ idempotencyKey: key() })
      .expect(403);
    const k = key();
    expect(
      (
        await finance
          .post(`/finance/receivables/${owing.id}/remind`)
          .send({ idempotencyKey: k })
          .expect(201)
      ).body,
    ).toMatchObject({ number: 1, created: true });
    expect(
      (
        await finance
          .post(`/finance/receivables/${owing.id}/remind`)
          .send({ idempotencyKey: k })
          .expect(201)
      ).body,
    ).toMatchObject({ number: 1, created: false });
    expect(
      await prisma.notification.count({
        where: { merchantId: owing.id, type: 'payment_reminder' },
      }),
    ).toBe(1);
    expect(
      await prisma.emailOutbox.count({ where: { merchantId: owing.id, kind: 'payment_reminder' } }),
    ).toBe(1);
    const after = (
      await accountant.get('/finance/aging/receivables').query({ q: 'owing' }).expect(200)
    ).body;
    expect(after.merchants[0].reminders.count).toBe(1);

    // A merchant in credit cannot be reminded.
    const credit = await prisma.merchant.create({ data: { name: 'Paid up' } });
    await finance
      .post(`/finance/receivables/${credit.id}/remind`)
      .send({ idempotencyKey: key() })
      .expect(409);
  });

  it('runs the daily reminder job once per day and debit period', async () => {
    const today = cairoDay(new Date());
    const owing = await prisma.merchant.create({ data: { name: 'Late Payer' } });
    await fee(owing.id, 5_000, new Date(cairoDayStart(addDays(today, -10)).getTime() + 3600_000));
    const jobs = app.get(JobsService);
    // Noon in Cairo, past the reminder hour.
    const noon = new Date(cairoDayStart(today).getTime() + 12 * 3600_000);
    expect(await jobs.runPaymentReminders(noon)).toMatchObject({ status: 'done' });
    expect(await jobs.runPaymentReminders(noon)).toBeNull();
    expect(await prisma.merchantPaymentReminder.count({ where: { merchantId: owing.id } })).toBe(1);
  });

  it('issues a debit note after a second person approves; the merchant sees it', async () => {
    const admin = await agent('admin@test.eg', 'admin-password-1');
    const finance = await agent('finance@shiplynow.local');
    const viewer = await createUser(prisma, {
      email: 'viewer2@test.eg',
      password: DEMO,
      role: 'finance',
    });
    await grantAccess(prisma, viewer.id, 'accountant');
    const accountant = await agent('viewer2@test.eg');
    const merchantUser = await prisma.user.findUniqueOrThrow({
      where: { email: 'merchant@evechantelle.example' },
    });
    const merchantId = merchantUser.merchantId!;
    const today = cairoDay(new Date());
    const [y, m] = today.split('-').map(Number) as [number, number];
    const last = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    await fee(merchantId, 10_000, new Date(cairoDayStart(`${last}-15`).getTime() + 3600_000));
    await finance.post('/finance/invoices/prepare').send({ month: last }).expect(201);
    const invoice = (await finance.get('/finance/invoices').expect(200)).body.find(
      (i: { type: string; merchant: { id: string } }) =>
        i.type === 'invoice' && i.merchant.id === merchantId,
    );
    const body = {
      lines: [{ kind: 'storage_fee', netPiastres: 2_500 }],
      reason: 'Storage days missed last month',
      idempotencyKey: key(),
    };
    await accountant.post(`/finance/invoices/${invoice.id}/debit-notes`).send(body).expect(403);
    await finance
      .post(`/finance/invoices/${invoice.id}/debit-notes`)
      .send({ ...body, lines: [{ kind: 'cod_collected', netPiastres: 1 }] })
      .expect(400);
    const asked = (
      await finance.post(`/finance/invoices/${invoice.id}/debit-notes`).send(body).expect(201)
    ).body;
    expect(asked.status).toBe('pending');
    await finance
      .post(`/finance/requests/${asked.requestId}/decide`)
      .send({ approve: true })
      .expect(403);
    await admin
      .post(`/finance/requests/${asked.requestId}/decide`)
      .send({ approve: true })
      .expect(201);
    const note = (await finance.get('/finance/invoices').expect(200)).body.find(
      (i: { type: string }) => i.type === 'debit_note',
    );
    expect(note).toMatchObject({ label: 'DN-000001', netPiastres: 2_500, original: invoice.label });
    expect(
      (await finance.get(`/finance/invoices/${invoice.id}`).expect(200)).body.debitNotes,
    ).toEqual([expect.objectContaining({ label: 'DN-000001' })]);
    // The search finds it by its number.
    expect((await finance.get('/finance/search').query({ q: 'dn-1' }).expect(200)).body).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'DN-000001' })]),
    );
    const merchant = await agent('merchant@evechantelle.example');
    const mine = (await merchant.get('/merchant/finance/invoices').expect(200)).body;
    expect(mine.map((i: { label: string }) => i.label)).toContain('DN-000001');
  });
});
