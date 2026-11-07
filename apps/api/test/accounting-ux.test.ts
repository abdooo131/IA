import type { INestApplication } from '@nestjs/common';
import type { PushMessage, PushOutcome, PushTarget } from '@shiplynow/db';
import { financeListGaps, writeAccess } from '@shiplynow/db';
import { addDays, cairoDay, JOB_ROLE_TEMPLATES } from '@shiplynow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JobsService } from '../src/jobs/jobs.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { PushSender } from '../src/push/push-sender';
import { createTestApp, resetAndSeed } from './helpers';

const DEMO = 'demo-password-1';
let n = 0;
const key = () => `ux-${++n}-${Date.now()}`;

class FakePush extends PushSender {
  enabled = true;
  publicKey: string | null = 'BPublicKeyForTests';
  sent: { endpoint: string; message: PushMessage }[] = [];
  async send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    this.sent.push({ endpoint: target.endpoint, message });
    return 'sent';
  }
}

describe('accounting list views, documents and the chatter', () => {
  const push = new FakePush();
  let app: INestApplication;
  let prisma: PrismaService;
  let seeded: Awaited<ReturnType<typeof resetAndSeed>>;

  const agent = async (email: string, password = DEMO) => {
    const a = request.agent(app.getHttpServer());
    await a.post('/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const admin = () => agent('admin@test.eg', 'admin-password-1');
  const userId = async (email: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { email } })).id;

  /** A draft payout made straight in the database (the merchant balance is not the point). */
  let payoutNo = 1;
  const payout = async (amountPiastres: number, createdById: string) =>
    prisma.payout.create({
      data: {
        number: payoutNo++,
        merchantId: seeded.merchantId,
        cutoffAt: new Date(),
        amountPiastres,
        createdById,
      },
    });
  const capitalIn = async (who: request.Agent, amountPiastres: number) => {
    const bank = await prisma.ledgerAccount.findUniqueOrThrow({ where: { key: 'bank' } });
    const res = await who
      .post('/finance/capital')
      .send({
        direction: 'in',
        moneyAccountId: bank.id,
        amountPiastres,
        reference: `Owner ${amountPiastres}`,
        idempotencyKey: key(),
      })
      .expect(201);
    return res.body.requestId as string;
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp({ push }));
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    push.sent = [];
    payoutNo = 1;
    seeded = await resetAndSeed(prisma);
  });

  it('implements every filter, grouping and sort the shared list meta names', () => {
    expect(financeListGaps()).toEqual([]);
  });

  it('filters, groups with subtotals, totals and pages a list on the server', async () => {
    const a = await admin();
    const me = await userId('admin@test.eg');
    const fin = await userId('finance@shiplynow.local');
    await payout(2_000_000, fin);
    await payout(300_000, me);
    const p3 = await payout(50_000, fin);
    await prisma.payout.update({ where: { id: p3.id }, data: { status: 'paid' } });

    const all = await a.get('/finance/lists/payouts?f=').expect(200);
    expect(all.body).toMatchObject({ total: 3, totals: { amount: 2_350_000 }, groups: null });

    const drafts = await a.get('/finance/lists/payouts?f=draft').expect(200);
    expect(drafts.body.total).toBe(2);
    // Filters of one group OR, groups AND.
    const either = await a.get('/finance/lists/payouts?f=draft,paid').expect(200);
    expect(either.body.total).toBe(3);
    const forMe = await a.get('/finance/lists/payouts?f=for_me_to_approve').expect(200);
    expect(forMe.body.rows.map((r: { amount: number }) => r.amount)).toEqual([2_000_000]);

    const grouped = await a.get('/finance/lists/payouts?f=&g=status,created_by').expect(200);
    expect(grouped.body.rows).toEqual([]);
    const draftGroup = grouped.body.groups.find((g: { key: string }) => g.key === 'draft');
    expect(draftGroup).toMatchObject({ count: 2, totals: { amount: 2_300_000 } });
    expect(draftGroup.groups).toHaveLength(2);
    const opened = await a
      .get(
        `/finance/lists/payouts?f=&g=status,created_by&open=${encodeURIComponent(`draft\n${fin}`)}`,
      )
      .expect(200);
    expect(opened.body.rows).toHaveLength(1);

    const searched = await a.get('/finance/lists/payouts?f=&q=PAY-000002').expect(200);
    expect(searched.body.total).toBe(1);
    const paged = await a.get('/finance/lists/payouts?f=&size=25&sort=amount').expect(200);
    expect(paged.body.rows.map((r: { amount: number }) => r.amount)).toEqual([
      50_000, 300_000, 2_000_000,
    ]);

    // The approvals list opens on waiting requests (its default filter).
    await capitalIn(a, 10_000);
    const approvals = await a.get('/finance/lists/approvals').expect(200);
    expect(approvals.body.rows.map((r: { status: string }) => r.status)).toEqual(['pending']);

    await a.get('/finance/lists/nope').expect(404);
    const staff = await agent('staff.newcairo@shiplynow.local');
    await staff.get('/finance/lists/payouts').expect(403);
  });

  it('keeps people limited to some stores to their stores', async () => {
    const fin = await userId('finance@shiplynow.local');
    const [ncr, other] = [...seeded.stores.values()];
    await prisma.$transaction((tx) =>
      writeAccess(
        tx,
        fin,
        { ...JOB_ROLE_TEMPLATES.finance_officer, allStores: false, jobRole: 'finance_officer' },
        [ncr!],
      ),
    );
    const rider = await prisma.rider.findFirstOrThrow();
    for (const [i, store] of [ncr!, other!].entries())
      await prisma.riderWithdrawal.create({
        data: {
          number: i + 1,
          riderId: rider.id,
          darkStoreId: store,
          amountPiastres: 10_000 * (i + 1),
          deductions: {},
          method: 'store_cash',
          details: {},
          idempotencyKey: key(),
        },
      });
    const finance = await agent('finance@shiplynow.local');
    const list = await finance.get('/finance/lists/rider_withdrawals?f=').expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.totals.amount).toBe(10_000);
    const a = await admin();
    expect((await a.get('/finance/lists/rider_withdrawals?f=').expect(200)).body.total).toBe(2);
    const outside = await prisma.riderWithdrawal.findFirstOrThrow({
      where: { darkStoreId: other },
    });
    await finance.get(`/finance/documents/rider_withdrawal/${outside.id}`).expect(403);
    await finance.get(`/records/rider_withdrawal/${outside.id}/notes`).expect(403);
  });

  it('bulk approves and rejects, checking each request on its own', async () => {
    const a = await admin();
    const finance = await agent('finance@shiplynow.local');
    const mine = await capitalIn(a, 10_000);
    const theirs = await capitalIn(finance, 20_000);
    const other = await capitalIn(finance, 30_000);

    const approve = await a
      .post('/finance/requests/bulk-decide')
      .send({ ids: [mine, theirs], approve: true })
      .expect(201);
    expect(approve.body.results).toEqual([
      { id: mine, ok: false, error: 'same_person' },
      { id: theirs, ok: true },
    ]);
    const noNote = await a
      .post('/finance/requests/bulk-decide')
      .send({ ids: [other], approve: false })
      .expect(201);
    expect(noNote.body.results[0]).toMatchObject({ ok: false, error: 'note_required' });
    const rejected = await a
      .post('/finance/requests/bulk-decide')
      .send({ ids: [other], approve: false, note: 'No such money' })
      .expect(201);
    expect(rejected.body.results[0]).toEqual({ id: other, ok: true });
    expect((await prisma.financeRequest.findUniqueOrThrow({ where: { id: other } })).status).toBe(
      'rejected',
    );

    // Viewers cannot decide at all.
    const fin = await userId('finance@shiplynow.local');
    await a.put(`/admin/users/${fin}/access`).send({ jobRole: 'accountant' }).expect(200);
    await finance
      .post('/finance/requests/bulk-decide')
      .send({ ids: [mine], approve: true })
      .expect(403);
  });

  it('bulk approves payouts above the limit only, never one own', async () => {
    const a = await admin();
    const me = await userId('admin@test.eg');
    const fin = await userId('finance@shiplynow.local');
    const big = await payout(2_000_000, fin);
    const own = await payout(2_000_000, me);
    const small = await payout(1_000, fin);
    const res = await a
      .post('/finance/payouts/bulk-approve')
      .send({ ids: [big.id, own.id, small.id] })
      .expect(201);
    expect(res.body.results).toEqual([
      { id: big.id, ok: true },
      { id: own.id, ok: false, error: 'same_person' },
      { id: small.id, ok: false, error: 'approval_not_needed' },
    ]);
    expect((await prisma.payout.findUniqueOrThrow({ where: { id: big.id } })).approvedById).toBe(
      me,
    );
  });

  it('shows a document with smart buttons and finds it by number or merchant', async () => {
    const a = await admin();
    const fin = await userId('finance@shiplynow.local');
    const p = await payout(2_000_000, fin);
    const doc = await a.get(`/finance/documents/payout/${p.id}`).expect(200);
    expect(doc.body).toMatchObject({
      number: 'PAY-000001',
      status: 'draft',
      flow: 'payout',
      entityType: 'payout',
      data: { needsApproval: true },
    });
    expect(doc.body.smart.map((s: { key: string }) => s.key)).toEqual([
      'merchant',
      'entries',
      'receipts',
      'emails',
    ]);
    await a.get('/finance/documents/payout/nope').expect(404);
    await a.get(`/finance/documents/unknown/${p.id}`).expect(404);

    const byNumber = await a.get('/finance/search?q=pay-1').expect(200);
    expect(byNumber.body[0]).toMatchObject({
      kind: 'payout',
      label: 'PAY-000001',
      href: `/finance/payouts/${p.id}`,
    });
    const merchant = await prisma.merchant.findUniqueOrThrow({ where: { id: seeded.merchantId } });
    const byName = await a
      .get(`/finance/search?q=${encodeURIComponent(merchant.name.slice(0, 5))}`)
      .expect(200);
    expect(byName.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'merchant', href: `/finance/merchants/${merchant.id}` }),
      ]),
    );
    expect((await a.get('/finance/search?q=x').expect(200)).body).toEqual([]);
  });

  it('keeps notes append only and audited, readable only with access', async () => {
    const a = await admin();
    const fin = await userId('finance@shiplynow.local');
    const p = await payout(2_000_000, fin);
    await a.post(`/records/payout/${p.id}/notes`).send({ body: 'Bank called' }).expect(201);
    const notes = await a.get(`/records/payout/${p.id}/notes`).expect(200);
    expect(notes.body).toEqual([expect.objectContaining({ body: 'Bank called' })]);
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'payout', entityId: p.id, action: 'record.note' },
    });
    expect(audit).not.toBeNull();
    await expect(
      prisma.recordNote.updateMany({ where: { entityId: p.id }, data: { body: 'changed' } }),
    ).rejects.toThrow();
    await expect(prisma.recordNote.deleteMany({ where: { entityId: p.id } })).rejects.toThrow();

    await a.post(`/records/payout/nope/notes`).send({ body: 'x' }).expect(404);
    await a.post(`/records/unknown/${p.id}/notes`).send({ body: 'x' }).expect(403);
    const staff = await agent('staff.newcairo@shiplynow.local');
    await staff.get(`/records/payout/${p.id}/notes`).expect(403);
    // A viewer reads but cannot write.
    await a.put(`/admin/users/${fin}/access`).send({ jobRole: 'accountant' }).expect(200);
    const finance = await agent('finance@shiplynow.local');
    await finance.get(`/records/payout/${p.id}/notes`).expect(200);
    await finance.post(`/records/payout/${p.id}/notes`).send({ body: 'x' }).expect(403);
  });

  it('schedules activities, lists them due and pushes each once', async () => {
    const a = await admin();
    const fin = await userId('finance@shiplynow.local');
    const p = await payout(2_000_000, fin);
    const today = cairoDay(new Date());
    await a
      .post(`/records/payout/${p.id}/activities`)
      .send({ dueOn: addDays(today, -1), note: 'late' })
      .expect(400);
    const people = await a.get(`/records/payout/${p.id}/people`).expect(200);
    expect(people.body.map((x: { id: string }) => x.id)).toContain(fin);
    const staffId = await userId('staff.newcairo@shiplynow.local');
    const refused = await a
      .post(`/records/payout/${p.id}/activities`)
      .send({ dueOn: today, note: 'Call the bank', assigneeId: staffId })
      .expect(400);
    expect(refused.body.error).toBe('assignee_not_allowed');
    const made = await a
      .post(`/records/payout/${p.id}/activities`)
      .send({ dueOn: today, note: 'Call the bank', assigneeId: fin })
      .expect(201);
    await a
      .post(`/records/payout/${p.id}/activities`)
      .send({ dueOn: addDays(today, 3), note: 'Later' })
      .expect(201);

    const finance = await agent('finance@shiplynow.local');
    const due = await finance.get('/me/activities?due=1').expect(200);
    expect(due.body).toEqual([
      expect.objectContaining({ note: 'Call the bank', label: 'PAY-000001' }),
    ]);
    const dash = await finance.get('/finance/dashboard').expect(200);
    expect(dash.body.activities).toHaveLength(1);
    expect(dash.body.todayItems.find((t: { key: string }) => t.key === 'myActivities').count).toBe(
      1,
    );

    await finance
      .post('/me/push/subscriptions')
      .send({
        endpoint: 'https://fcm.googleapis.com/fcm/send/fin',
        keys: {
          p256dh:
            'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
          auth: 'tBHItJI5svbpez7KI4CCXg',
        },
        lang: 'en',
      })
      .expect(200);
    const jobs = app.get(JobsService);
    await jobs.runPush();
    const reminders = push.sent.filter((s) => s.message.title.startsWith('Reminder'));
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.message).toMatchObject({
      title: 'Reminder: PAY-000001',
      body: 'Call the bank',
      url: `/finance/payouts/${p.id}`,
    });
    push.sent = [];
    await jobs.runPush();
    expect(push.sent.filter((s) => s.message.title.startsWith('Reminder'))).toEqual([]);

    // Only the person reminded (or who scheduled it) marks it done.
    const staff = await agent('staff.newcairo@shiplynow.local');
    await staff.post(`/records/activities/${made.body.id}/done`).expect(403);
    await finance.post(`/records/activities/${made.body.id}/done`).expect(201);
    expect((await finance.get('/me/activities?due=1').expect(200)).body).toEqual([]);
  });

  it('saves favourites per person with one default, and chosen columns', async () => {
    const a = await admin();
    const one = await a
      .post('/me/list-favorites')
      .send({ listKey: 'payouts', name: 'Drafts', query: 'f=draft', isDefault: true })
      .expect(201);
    await a
      .post('/me/list-favorites')
      .send({ listKey: 'payouts', name: 'Paid', query: 'f=paid', isDefault: true })
      .expect(201);
    const list = await a.get('/me/list-favorites?list=payouts').expect(200);
    expect(
      list.body.map((f: { name: string; isDefault: boolean }) => [f.name, f.isDefault]),
    ).toEqual([
      ['Drafts', false],
      ['Paid', true],
    ]);
    const finance = await agent('finance@shiplynow.local');
    expect((await finance.get('/me/list-favorites?list=payouts').expect(200)).body).toEqual([]);
    await finance.delete(`/me/list-favorites/${one.body.id}`).expect(404);
    await a.delete(`/me/list-favorites/${one.body.id}`).expect(200);

    expect((await a.get('/me/list-prefs/payouts').expect(200)).body).toEqual({ columns: null });
    await a
      .put('/me/list-prefs/payouts')
      .send({ columns: ['number', 'amount'] })
      .expect(200);
    expect((await a.get('/me/list-prefs/payouts').expect(200)).body.columns).toEqual([
      'number',
      'amount',
    ]);
  });

  it('builds the dashboard cards inside the person scope', async () => {
    const a = await admin();
    const dash = await a.get('/finance/dashboard').expect(200);
    const kinds = dash.body.cards.map((c: { kind: string }) => c.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(['bank', 'payouts', 'bills', 'invoices', 'riders', 'approvals']),
    );
    for (const c of dash.body.cards) expect(c.spark).toHaveLength(30);
    const fin = await userId('finance@shiplynow.local');
    const [ncr] = [...seeded.stores.values()];
    await prisma.$transaction((tx) =>
      writeAccess(
        tx,
        fin,
        { ...JOB_ROLE_TEMPLATES.finance_officer, allStores: false, jobRole: 'finance_officer' },
        [ncr!],
      ),
    );
    const finance = await agent('finance@shiplynow.local');
    const limited = await finance.get('/finance/dashboard').expect(200);
    const limitedKinds = limited.body.cards.map((c: { kind: string }) => c.kind);
    expect(limitedKinds).not.toContain('bank');
    expect(limitedKinds).not.toContain('payouts');
    expect(limited.body.scope).toBe('stores');
  });
});
