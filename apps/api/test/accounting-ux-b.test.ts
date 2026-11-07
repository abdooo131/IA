import type { INestApplication } from '@nestjs/common';
import { addDays, cairoDay } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { post, setSetting } from '@shiplynow/db';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';
let n = 0;
const key = () => `uxb-${++n}-${Date.now()}`;

describe('accounting UX phase B: drill down reports, bank matching and the runs', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let seeded: Awaited<ReturnType<typeof resetAndSeed>>;

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const admin = () => agent('admin@test.eg', 'admin-password-1');
  const bank = () => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: 'bank' } });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    seeded = await resetAndSeed(prisma);
    // Second person rules off: these tests are about the screens, not the approvals.
    await setSetting(prisma, { key: 'finance.approve_money_in', value: 0, actorUserId: null });
    await setSetting(prisma, {
      key: 'finance.approval_threshold_piastres',
      value: 0,
      actorUserId: null,
    });
  });

  it('answers drill down reports whose lines add up to the ledger lines behind them', async () => {
    const a = await admin();
    const cib = await bank();
    const today = cairoDay(new Date());
    await a
      .post('/finance/capital')
      .send({
        direction: 'in',
        moneyAccountId: cib.id,
        amountPiastres: 500_000,
        reference: 'Owner',
        idempotencyKey: key(),
      })
      .expect(201);
    const rent = await prisma.ledgerAccount.findUniqueOrThrow({ where: { key: 'expense:rent' } });
    const storeId = (await prisma.darkStore.findFirstOrThrow({ where: { kind: 'dark_store' } })).id;
    await a
      .post('/finance/expenses')
      .send({
        expenseAccountId: rent.id,
        paidFromAccountId: cib.id,
        amountPiastres: 12_000,
        reference: 'Rent',
        memo: 'Rent of the store',
        darkStoreId: storeId,
        idempotencyKey: key(),
      })
      .expect(201);

    const pl = await a
      .get(`/finance/reports/profit_and_loss?from=${today.slice(0, 8)}01&to=${today}&compare=previous`)
      .expect(200);
    const plain = await a
      .get(`/finance/profit-and-loss?from=${today.slice(0, 8)}01&to=${today}`)
      .expect(200);
    expect(pl.body.result.amountPiastres).toBe(plain.body.profitPiastres);
    expect(pl.body.compare.mode).toBe('previous');
    const rentLine = pl.body.sections[1].lines.find(
      (l: { accountId: string }) => l.accountId === rent.id,
    );
    expect(rentLine).toMatchObject({ amountPiastres: 12_000, compareAmountPiastres: 0 });
    const lines = await a
      .get(
        `/finance/ledger-lines?account=${rent.id}&from=${today.slice(0, 8)}01&to=${today}&report=profit_and_loss`,
      )
      .expect(200);
    expect(lines.body.totals.net).toBe(12_000);
    expect(lines.body.meta.naturalDebit).toBe(true);
    expect(lines.body.rows[0]).toMatchObject({ storeId: storeId, debit: 12_000 });
    // Filters by store and group by month like every list.
    const byStore = await a
      .get(`/finance/ledger-lines?account=${rent.id}&store=${storeId}&g=month`)
      .expect(200);
    expect(byStore.body.groups[0].totals.debit).toBe(12_000);

    const bs = await a.get(`/finance/reports/balance_sheet?to=${today}`).expect(200);
    expect(bs.body.result.amountPiastres).toBe(0);
    await a.get('/finance/reports/trial_balance').expect(200);
    await a.get('/finance/reports/nothing').expect(404);

    for (const lang of ['en', 'ar']) {
      const pdf = await a
        .get(`/finance/reports/profit_and_loss/export.pdf?lang=${lang}&compare=last_year`)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    }
  });

  it('shows bank lines with suggestions and matches several ledger lines to one', async () => {
    const a = await admin();
    const cib = await bank();
    const day = addDays(cairoDay(new Date()), -2);
    for (const amount of [40_000, 10_000])
      await a
        .post('/finance/capital')
        .send({
          direction: 'in',
          moneyAccountId: cib.id,
          amountPiastres: amount,
          reference: `Owner ${amount}`,
          day,
          idempotencyKey: key(),
        })
        .expect(201);
    await a
      .post('/finance/bank-statements')
      .send({
        accountId: cib.id,
        fileName: 'cib.csv',
        lines: [{ day, description: 'Two deposits', amountPiastres: 50_000 }],
      })
      .expect(201);
    const view = await a.get(`/finance/bank-matching/${cib.id}`).expect(200);
    expect(view.body.lines).toHaveLength(1);
    const top = view.body.lines[0].suggestions[0];
    expect(top).toMatchObject({ reason: 'sum', matchable: true });
    await a
      .post(`/finance/bank-lines/${view.body.lines[0].id}/match-many`)
      .send({ ledgerLineIds: [top.ids[0]] })
      .expect(409);
    await a
      .post(`/finance/bank-lines/${view.body.lines[0].id}/match-many`)
      .send({ ledgerLineIds: top.ids })
      .expect(201);
    const after = await a.get(`/finance/bank-matching/${cib.id}`).expect(200);
    expect(after.body.statement).toMatchObject({ total: 1, done: 1 });
  });

  it('runs Pay merchants: prepare, then mark paid with one reference, twice safely', async () => {
    const a = await admin();
    await prisma.merchant.update({
      where: { id: seeded.merchantId },
      data: { payoutSchedule: 'daily', iban: `EG${'2'.repeat(27)}` },
    });
    // COD collected two days ago: the merchant is owed it.
    await post(prisma, {
      kind: 'cod_collected',
      idempotencyKey: key(),
      occurredAt: new Date(Date.now() - 2 * 86_400_000),
      lines: [
        { account: { type: 'bank' }, amount: 70_000 },
        { account: { type: 'merchant', merchantId: seeded.merchantId }, amount: -70_000 },
      ],
    });
    let run = await a.get('/finance/payouts/run').expect(200);
    expect(run.body.current).toBe('prepare');
    await a.post('/finance/payouts/due').send({ cutoffDay: run.body.cutoffDay }).expect(201);
    run = await a.get('/finance/payouts/run').expect(200);
    expect(run.body.current).toBe('file');
    const ids = run.body.drafts.map((d: { id: string }) => d.id);
    const paid = await a
      .post('/finance/payouts/run/mark-paid')
      .send({ ids, reference: 'CIB-BULK-7' })
      .expect(201);
    expect(paid.body.results.every((r: { ok: boolean }) => r.ok)).toBe(true);
    const again = await a
      .post('/finance/payouts/run/mark-paid')
      .send({ ids, reference: 'CIB-BULK-7' })
      .expect(201);
    expect(again.body.results[0]).toMatchObject({ ok: true, already: true });
    run = await a.get('/finance/payouts/run').expect(200);
    expect(run.body).toMatchObject({ current: 'done', totals: { paidPiastres: 70_000 } });
  });
});
