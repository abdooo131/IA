import type { INestApplication } from '@nestjs/common';
import { createSupplier, ensureDefaultAccounts, recordBill, writeAccess } from '@shiplynow/db';
import { addDays, cairoDay, JOB_ROLE_TEMPLATES } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';
let n = 0;
const key = () => `due-${++n}-${Date.now()}`;

describe('coming up and due (GET /finance/payments-due)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let seeded: Awaited<ReturnType<typeof resetAndSeed>>;

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const admin = () => agent('admin@test.eg', 'admin-password-1');

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    seeded = await resetAndSeed(prisma);
  });

  it('lists known payments in groups, inside the person scope, for Accounting only', async () => {
    await ensureDefaultAccounts(prisma);
    const actor = (await prisma.user.findUniqueOrThrow({ where: { email: 'admin@test.eg' } })).id;
    const expense = await prisma.ledgerAccount.findUniqueOrThrow({
      where: { key: 'expense:maintenance' },
    });
    const supplier = await createSupplier(prisma, {
      name: 'Landlord',
      defaultExpenseAccountId: expense.id,
      actorUserId: actor,
    });
    const [first, second] = [...seeded.stores.values()];
    const today = cairoDay(new Date());
    const bill = (store: string | null, due: string, net: number) =>
      recordBill(prisma, {
        supplierId: supplier.id,
        reference: `R-${net}`,
        billDate: addDays(today, -10),
        dueDate: due,
        netPiastres: net,
        darkStoreId: store,
        actorUserId: actor,
        idempotencyKey: key(),
      });
    const late = await bill(null, addDays(today, -2), 10_000);
    const soon = await bill(second!, addDays(today, 4), 20_000);
    const far = await bill(null, addDays(today, 60), 30_000);

    const a = await admin();
    const dash = await a.get('/finance/payments-due').expect(200);
    expect(dash.body.groups.map((g: { key: string }) => g.key)).toEqual([
      'overdue',
      'week',
      'month',
    ]);
    const keys = (body: { items: { key: string }[] }) => body.items.map((i) => i.key);
    expect(keys(dash.body)).toEqual(expect.arrayContaining([`bill:${late.id}`, `bill:${soon.id}`]));
    expect(keys(dash.body)).not.toContain(`bill:${far.id}`);
    const overdue = dash.body.groups.find((g: { key: string }) => g.key === 'overdue');
    expect(overdue.items.map((i: { key: string }) => i.key)).toContain(`bill:${late.id}`);

    const page = await a.get('/finance/payments-due?days=90&kinds=bill').expect(200);
    expect(keys(page.body).sort()).toEqual(
      [`bill:${late.id}`, `bill:${soon.id}`, `bill:${far.id}`].sort(),
    );
    expect(page.body.groups.map((g: { key: string }) => g.key)).toContain('later');
    await a.get('/finance/payments-due?days=91').expect(400);

    // Limited to one store: the other store's bill is hidden, company wide ones stay.
    const fin = (
      await prisma.user.findUniqueOrThrow({ where: { email: 'finance@shiplynow.local' } })
    ).id;
    await prisma.$transaction((tx) =>
      writeAccess(
        tx,
        fin,
        { ...JOB_ROLE_TEMPLATES.finance_officer, allStores: false, jobRole: 'finance_officer' },
        [first!],
      ),
    );
    const finance = await agent('finance@shiplynow.local');
    const limited = await finance.get('/finance/payments-due?days=90').expect(200);
    expect(keys(limited.body)).toContain(`bill:${late.id}`);
    expect(keys(limited.body)).not.toContain(`bill:${soon.id}`);
    expect(limited.body.items.some((i: { kind: string }) => i.kind === 'payout')).toBe(false);

    // No Accounting access: refused.
    const staff = await agent('staff.newcairo@shiplynow.local');
    await staff.get('/finance/payments-due').expect(403);
    await request(app.getHttpServer()).get('/finance/payments-due').expect(401);
  });
});
