import type { INestApplication } from '@nestjs/common';
import {
  ensureDefaultAccounts,
  recordCapital,
  setSalaryPackage,
  setSetting,
  submitPayroll,
  writeAccess,
} from '@shiplynow/db';
import { addDays, cairoDay, JOB_ROLE_TEMPLATES } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetAndSeed } from './helpers';

// Payslips in My HR and employee expense claims: each person sees only their own; the manager
// in force approves a claim, Accounting pays it inside its stores.

const DEMO = 'demo-password-1';
const PASSWORD = 'member-password-1';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe('payslips and expense claims', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let stores: Map<string, string>;
  let admin: ReturnType<typeof request.agent>;
  let n = 0;
  const key = () => `pec-${++n}-${Math.random().toString(36).slice(2)}`;
  const today = cairoDay(new Date());
  const lastMonth = addDays(`${today.slice(0, 8)}01`, -1).slice(0, 7);

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const member = async (email: string, jobRole: string, extra: Record<string, unknown> = {}) => {
    const res = await admin
      .post('/admin/users')
      .send({ email, name: email, role: 'admin', jobRole, password: PASSWORD, ...extra })
      .expect(201);
    return { id: res.body.id as string, agent: await agent(email, PASSWORD) };
  };
  const fileOf = (email: string) =>
    prisma.employee.findFirstOrThrow({ where: { user: { email } } });
  const userOf = (email: string) => prisma.user.findUniqueOrThrow({ where: { email } });
  const bank = () => prisma.ledgerAccount.findUniqueOrThrow({ where: { key: 'bank' } });
  const receipt = async (a: ReturnType<typeof request.agent>) =>
    (await a.post('/photos?kind=receipt').set('content-type', 'image/jpeg').send(JPEG).expect(201))
      .body.id as string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    ({ stores } = await resetAndSeed(prisma));
    admin = await agent('admin@test.eg', 'admin-password-1');
    await ensureDefaultAccounts(prisma);
    await recordCapital(prisma, {
      direction: 'in',
      moneyAccountId: (await bank()).id,
      amountPiastres: 10_000_000,
      reference: 'Owner',
      actorUserId: (await userOf('admin@test.eg')).id,
      idempotencyKey: key(),
    });
  });

  it('shows each person only their own payslips, and only once the run is posted', async () => {
    const adminId = (await userOf('admin@test.eg')).id;
    const staffUser = await userOf('staff.newcairo@shiplynow.local');
    const otherUser = await userOf('staff.maadi@shiplynow.local');
    for (const [u, basic] of [
      [staffUser, 900_000],
      [otherUser, 700_000],
    ] as const)
      await setSalaryPackage(prisma, {
        employeeId: (await fileOf(u.email)).id,
        body: {
          effectiveFrom: '2026-01-01',
          basicPiastres: basic,
          allowances: [{ kind: 'housing', amountPiastres: 100_000 }],
        },
        actorUserId: adminId,
      });
    await setSetting(prisma, {
      key: 'finance.approval_threshold_piastres',
      value: 1_000,
      actorUserId: adminId,
    });
    const sent = await submitPayroll(prisma, {
      month: lastMonth,
      moneyAccountId: (await bank()).id,
      lines: [{ userId: staffUser.id }],
      actorUserId: adminId,
    });
    expect(sent.status).toBe('pending');
    const staff = await agent('staff.newcairo@shiplynow.local');
    expect((await staff.get('/me/payslips').expect(200)).body).toEqual({
      payBasis: 'monthly_salary',
      payslips: [],
    });
    await staff.get(`/me/payslips/${lastMonth}`).expect(404);

    // A second person approves: the run is posted and the payslip appears.
    const finance = await agent('finance@shiplynow.local');
    await finance
      .post(`/finance/requests/${(sent as { request: { id: string } }).request.id}/decide`)
      .send({ approve: true })
      .expect((res) => expect([200, 201]).toContain(res.status));
    const list = (await staff.get('/me/payslips').expect(200)).body;
    expect(list.payslips.map((s: { month: string }) => s.month)).toEqual([lastMonth]);
    const slip = (await staff.get(`/me/payslips/${lastMonth}`).expect(200)).body;
    expect(slip).toMatchObject({
      userId: staffUser.id,
      base: 1_000_000,
      basic: 900_000,
      allowances: [{ kind: 'housing', amountPiastres: 100_000 }],
      gross: 1_000_000,
      paidFrom: { code: (await bank()).code },
    });
    expect(slip.entryNumber).toMatch(/^JV-/);
    // The other person was not on this run: nothing to see, and never staff's slip.
    const other = await agent('staff.maadi@shiplynow.local');
    expect((await other.get('/me/payslips').expect(200)).body.payslips).toEqual([]);
    await other.get(`/me/payslips/${lastMonth}`).expect(404);
    // Riders are paid per delivery: no payslips, their wallet instead.
    const rider = await agent('rider.newcairo@shiplynow.local');
    expect((await rider.get('/me/payslips').expect(200)).body).toEqual({
      payBasis: 'per_delivery',
      payslips: [],
    });
  });

  it('runs a claim from the person to the manager to Accounting, inside Accounting’s stores', async () => {
    const lead = await member('lead@shiply.eg', 'store_manager', {
      storeIds: [stores.get('NCR')],
    });
    await prisma.employee.update({
      where: { id: (await fileOf('staff.newcairo@shiplynow.local')).id },
      data: { managerId: (await fileOf('lead@shiply.eg')).id },
    });
    const fuel = await prisma.ledgerAccount.findUniqueOrThrow({ where: { key: 'expense:fuel' } });
    const finance = await agent('finance@shiplynow.local');
    // Only claimable categories are offered; store staff cannot mark them.
    const staff = await agent('staff.newcairo@shiplynow.local');
    await staff
      .post(`/finance/expense-claims/categories/${fuel.id}`)
      .send({ claimable: true })
      .expect(403);
    await finance
      .post(`/finance/expense-claims/categories/${fuel.id}`)
      .send({ claimable: true })
      .expect(201);
    const form = (await staff.get('/me/expense-claims').expect(200)).body;
    expect(form.categories.map((c: { id: string }) => c.id)).toEqual([fuel.id]);
    expect(form.maxAgeDays).toBe(60);

    const body = {
      amountPiastres: 15_000,
      expenseAccountId: fuel.id,
      darkStoreId: stores.get('NCR'),
      paidOn: today,
      note: 'Taxi with the scanner',
      photoId: await receipt(staff),
      idempotencyKey: key(),
    };
    await staff
      .post('/me/expense-claims')
      .send({ ...body, paidOn: addDays(today, 1), idempotencyKey: key() })
      .expect(400);
    const claim = (await staff.post('/me/expense-claims').send(body).expect(201)).body;
    expect(claim).toMatchObject({ number: 'EC-000001', status: 'pending_manager' });
    // The same key records it once.
    expect((await staff.post('/me/expense-claims').send(body).expect(201)).body.id).toBe(claim.id);

    // Another person cannot read it, nor see it in their list.
    const other = await agent('staff.maadi@shiplynow.local');
    await other.get(`/me/expense-claims/${claim.id}`).expect(404);
    await other.get(`/me/team-expense-claims/${claim.id}`).expect(404);
    expect((await other.get('/me/expense-claims').expect(200)).body.claims).toEqual([]);
    await staff.get(`/me/expense-claims/${claim.id}`).expect(200);

    // Accounting cannot pay before the manager approves; the person cannot approve their own.
    await finance
      .post(`/finance/expense-claims/${claim.id}/pay`)
      .send({ moneyAccountId: (await bank()).id })
      .expect(409);
    await staff.post(`/me/inbox/expense-claims/${claim.id}/approve`).expect(403);
    const inbox = (await lead.agent.get('/me/inbox').expect(200)).body;
    expect(inbox.manager.claims.map((c: { id: string }) => c.id)).toEqual([claim.id]);
    expect((await lead.agent.get('/me/hr-badges').expect(200)).body.inbox).toBe(1);
    await lead.agent.get(`/me/team-expense-claims/${claim.id}`).expect(200);
    await lead.agent.post(`/me/inbox/expense-claims/${claim.id}/approve`).expect(201);

    // Accounting limited to another store does not see it.
    const limited = await member('fin2@shiply.eg', 'finance_officer');
    await prisma.$transaction((tx) =>
      writeAccess(
        tx,
        limited.id,
        { ...JOB_ROLE_TEMPLATES.finance_officer, allStores: false, jobRole: 'finance_officer' },
        [stores.get('MAA')!],
      ),
    );
    expect(
      (await limited.agent.get('/finance/lists/expense_claims?f=').expect(200)).body.total,
    ).toBe(0);
    await limited.agent.get(`/finance/documents/expense_claim/${claim.id}`).expect(403);
    await limited.agent
      .post(`/finance/expense-claims/${claim.id}/pay`)
      .send({ moneyAccountId: (await bank()).id })
      .expect(403);
    // Store staff have no accounting.
    await staff.get('/finance/lists/expense_claims').expect(403);

    // Accounting with every store reads and pays it.
    const rows = (await finance.get('/finance/lists/expense_claims').expect(200)).body.rows;
    expect(rows.map((r: { id: string }) => r.id)).toEqual([claim.id]);
    const doc = (await finance.get(`/finance/documents/expense_claim/${claim.id}`).expect(200))
      .body;
    expect(doc).toMatchObject({ number: 'EC-000001', status: 'pending_accounting' });
    expect(doc.actions).toEqual(['pay', 'reject']);
    const page = (await finance.get(`/finance/expense-claims/${claim.id}`).expect(200)).body;
    expect(page.moneyAccounts.some((a: { id: string }) => a.id)).toBe(true);
    const paid = (
      await finance
        .post(`/finance/expense-claims/${claim.id}/pay`)
        .send({ moneyAccountId: (await bank()).id, reference: 'CIB-778' })
        .expect(201)
    ).body;
    expect(paid.status).toBe('paid');
    const entry = await prisma.ledgerEntry.findUniqueOrThrow({
      where: { idempotencyKey: `expense_claim:${claim.id}` },
      include: { lines: true },
    });
    const staffId = (await userOf('staff.newcairo@shiplynow.local')).id;
    expect(entry.lines.find((l) => l.accountId === fuel.id)).toMatchObject({
      amountPiastres: 15_000,
      darkStoreId: stores.get('NCR'),
      userId: staffId,
    });
    expect((await staff.get('/me/expense-claims').expect(200)).body.claims[0].status).toBe('paid');
    // The chatter of a claim belongs to accounting.
    await finance.get(`/records/expense_claim/${claim.id}/notes`).expect(200);
    await staff.get(`/records/expense_claim/${claim.id}/notes`).expect(403);
  });

  it('lets the person cancel before approval, and refuses a claim too far back', async () => {
    const fuel = await prisma.ledgerAccount.findUniqueOrThrow({ where: { key: 'expense:fuel' } });
    await prisma.ledgerAccount.update({ where: { id: fuel.id }, data: { claimable: true } });
    // A rider uploads their own receipt and claims.
    const rider = await agent('rider.newcairo@shiplynow.local');
    const body = {
      amountPiastres: 5_000,
      expenseAccountId: fuel.id,
      darkStoreId: null,
      paidOn: addDays(today, -61),
      note: 'Fuel for the bike',
      photoId: await receipt(rider),
      idempotencyKey: key(),
    };
    expect((await rider.post('/me/expense-claims').send(body).expect(400)).body.error).toBe(
      'claim_too_old',
    );
    // VAT on the receipt is optional, never the whole amount or more.
    const vatTooBig = { ...body, paidOn: today, vatPiastres: 5_000, idempotencyKey: key() };
    expect((await rider.post('/me/expense-claims').send(vatTooBig).expect(400)).body.error).toBe(
      'invalid_vat',
    );
    const withVat = (
      await rider
        .post('/me/expense-claims')
        .send({ ...body, paidOn: today, vatPiastres: 614, idempotencyKey: key() })
        .expect(201)
    ).body;
    expect(withVat).toMatchObject({ amountPiastres: 5_000, vatPiastres: 614 });
    await rider.post(`/me/expense-claims/${withVat.id}/cancel`).expect(201);
    const claim = (
      await rider
        .post('/me/expense-claims')
        .send({ ...body, paidOn: today, idempotencyKey: key() })
        .expect(201)
    ).body;
    expect(claim).toMatchObject({ number: 'EC-000002', cancellable: true, vatPiastres: 0 });
    const staff = await agent('staff.newcairo@shiplynow.local');
    await staff.post(`/me/expense-claims/${claim.id}/cancel`).expect(404);
    expect(
      (await rider.post(`/me/expense-claims/${claim.id}/cancel`).expect(201)).body.status,
    ).toBe('cancelled');
    // Merchants have no file and no claims.
    const merchant = await agent('merchant@evechantelle.example');
    await merchant.get('/me/expense-claims').expect(404);
    await merchant.get('/me/payslips').expect(404);
  });
});
