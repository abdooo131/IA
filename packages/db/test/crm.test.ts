import { JOB_ROLE_TEMPLATES, type JobRole } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { writeAccess } from '../src/access';
import {
  assignDeal,
  changeStage,
  completeActivity,
  createActivity,
  createDeal,
  crmActor,
  type CrmActor,
  crmReminders,
  ensureLostReasons,
  getCompany,
  getDeal,
  listCompanies,
  listDeals,
  myDay,
} from '../src/crm';
import {
  dispatchPush,
  type PushMessage,
  type PushOutcome,
  type PushSender,
  type PushTarget,
} from '../src/push';
import { setSetting } from '../src/settings';
import { signUpMerchant } from '../src/signup';
import { createSiteLead } from '../src/site-leads';
import { prisma, resetDatabase } from './helpers';

let manager: CrmActor;
let repA: CrmActor;
let repB: CrmActor;
let viewer: CrmActor;
let n = 0;
const key = () => `crm-test-key-${++n}`.padEnd(12, '0');

async function person(
  name: string,
  job: JobRole,
  extra: Partial<typeof JOB_ROLE_TEMPLATES.owner> = {},
) {
  const user = await prisma.user.create({
    data: { email: `${name}@t.eg`, name, role: 'admin', passwordHash: 'x' },
  });
  const values = { ...JOB_ROLE_TEMPLATES[job], ...extra, jobRole: job };
  const profile = await prisma.$transaction((tx) => writeAccess(tx, user.id, values, []));
  await prisma.pushSubscription.create({
    data: { userId: user.id, endpoint: `https://push.test/${name}`, p256dh: 'k', auth: 'a' },
  });
  return crmActor(profile, user.id);
}

const newDeal = (actor: CrmActor, brandName: string, extra: Record<string, unknown> = {}) =>
  createDeal(
    prisma,
    {
      company: { brandName, source: 'manual' },
      contact: { name: `${brandName} owner`, phone: '01012345678', whatsapp: true },
      idempotencyKey: key(),
      ...extra,
    },
    actor,
  );

beforeEach(async () => {
  await resetDatabase();
  await ensureLostReasons(prisma);
  manager = await person('manager', 'sales_manager');
  repA = await person('repA', 'sales_rep');
  repB = await person('repB', 'sales_rep');
  viewer = await person('viewer', 'owner', { sales: 'view' });
});

afterAll(() => prisma.$disconnect());

describe('deals and stages', () => {
  it('numbers deals without gaps, even when created at once', async () => {
    const made = await Promise.all(
      ['A', 'B', 'C', 'D', 'E'].map((b) => newDeal(repA, `Brand ${b}`)),
    );
    const deals = await prisma.crmDeal.findMany({ where: { id: { in: made.map((m) => m.id) } } });
    expect(deals.map((d) => d.number).sort()).toEqual([1, 2, 3, 4, 5]);
    const card = (await listDeals(prisma, repA)).find((d) => d.number === 1)!;
    expect(card.label).toBe('DEAL-000001');
    // The same key twice is one deal.
    const once = await createDeal(
      prisma,
      { company: { brandName: 'Twice', source: 'manual' }, idempotencyKey: 'twice-key-01' },
      repA,
    );
    const again = await createDeal(
      prisma,
      { company: { brandName: 'Twice', source: 'manual' }, idempotencyKey: 'twice-key-01' },
      repA,
    );
    expect(again).toEqual({ id: once.id, created: false });
  });

  it('gives a rep their own deal and keeps a manager deal in the queue', async () => {
    const mine = await newDeal(repA, 'Mine');
    const queued = await newDeal(manager, 'Queued');
    const [a, q] = await Promise.all([
      getDeal(prisma, mine.id, repA),
      getDeal(prisma, queued.id, manager),
    ]);
    expect(a.owner?.id).toBe(repA.userId);
    expect(a.company.contacts[0]).toMatchObject({ phone: '+201012345678', phoneValid: true });
    expect(q.owner).toBeNull();
    // A rep cannot hand a deal to someone else.
    await expect(newDeal(repA, 'Other', { ownerId: repB.userId })).rejects.toMatchObject({
      code: 'owner_not_allowed',
    });
    // View cannot write.
    await expect(newDeal(viewer, 'Nope')).rejects.toMatchObject({ code: 'no_access' });
  });

  it('keeps every stage in the history and needs a reason to lose', async () => {
    const { id } = await newDeal(repA, 'Stages');
    await changeStage(prisma, id, { stage: 'contacted' }, repA);
    await changeStage(prisma, id, { stage: 'meeting' }, repA);
    await expect(changeStage(prisma, id, { stage: 'meeting' }, repA)).rejects.toMatchObject({
      code: 'same_stage',
    });
    await expect(changeStage(prisma, id, { stage: 'lost' }, repA)).rejects.toMatchObject({
      code: 'lost_reason_required',
    });
    await expect(
      changeStage(prisma, id, { stage: 'lost', lostReason: 'other' }, repA),
    ).rejects.toMatchObject({ code: 'lost_note_required' });
    await expect(
      changeStage(prisma, id, { stage: 'lost', lostReason: 'made_up' }, repA),
    ).rejects.toMatchObject({ code: 'lost_reason_unknown' });
    const lost = await changeStage(prisma, id, { stage: 'lost', lostReason: 'price' }, repA);
    expect(lost).toMatchObject({ stage: 'lost', lostReason: 'price' });
    expect(lost.lostAt).not.toBeNull();
    const won = await changeStage(prisma, id, { stage: 'won' }, repA);
    expect(won).toMatchObject({ stage: 'won', lostReason: null, lostAt: null });
    expect(won.wonAt).not.toBeNull();

    const history = await prisma.crmDealStageHistory.findMany({
      where: { dealId: id },
      orderBy: { changedAt: 'asc' },
    });
    expect(history.map((h) => [h.fromStage, h.toStage])).toEqual([
      [null, 'new'],
      ['new', 'contacted'],
      ['contacted', 'meeting'],
      ['meeting', 'lost'],
      ['lost', 'won'],
    ]);
    // The history is append only, and the database refuses a lost deal without a reason.
    await expect(
      prisma.crmDealStageHistory.update({ where: { id: history[0]!.id }, data: { note: 'x' } }),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`UPDATE crm_deals SET stage = 'lost', lost_reason = NULL, lost_at = now() WHERE id = ${id}`,
    ).rejects.toThrow();
    const audit = await prisma.auditLog.count({
      where: { entityId: id, action: 'crm_deal.stage' },
    });
    expect(audit).toBe(4);
  });
});

describe('own deals only', () => {
  it('shows a rep only their own companies, deals and activities', async () => {
    const a = await newDeal(repA, 'Alpha');
    const b = await newDeal(repB, 'Beta');
    await newDeal(manager, 'Queue');
    expect((await listDeals(prisma, repA)).map((d) => d.company.brandName)).toEqual(['Alpha']);
    expect((await listDeals(prisma, manager)).length).toBe(3);
    // Sales view without own_deals_only reads everything.
    expect((await listDeals(prisma, viewer)).length).toBe(3);
    // A rep's owner filter cannot widen what they see.
    expect(await listDeals(prisma, repA, { ownerId: repB.userId })).toHaveLength(1);
    expect((await listCompanies(prisma, repA)).map((c) => c.brandName)).toEqual(['Alpha']);

    await expect(getDeal(prisma, b.id, repA)).rejects.toMatchObject({
      code: 'deal_not_allowed',
      status: 403,
    });
    await expect(changeStage(prisma, b.id, { stage: 'contacted' }, repA)).rejects.toMatchObject({
      code: 'deal_not_allowed',
    });
    const companyB = (await getDeal(prisma, b.id, repB)).companyId;
    await expect(getCompany(prisma, companyB, repA)).rejects.toMatchObject({
      code: 'deal_not_allowed',
    });
    await expect(
      createActivity(
        prisma,
        { dealId: b.id, type: 'call', subject: 'Sneak', done: true, idempotencyKey: key() },
        repA,
      ),
    ).rejects.toMatchObject({ code: 'deal_not_allowed' });
    const theirs = await createActivity(
      prisma,
      {
        dealId: b.id,
        type: 'call',
        subject: 'Call back',
        dueAt: new Date(Date.now() + 3600_000).toISOString(),
        done: false,
        idempotencyKey: key(),
      },
      repB,
    );
    await expect(completeActivity(prisma, theirs.id, null, repA)).rejects.toMatchObject({
      code: 'deal_not_allowed',
    });
    expect((await getDeal(prisma, a.id, repA)).id).toBe(a.id);
  });

  it('lets a manager reassign: the company and open follow ups follow the deal', async () => {
    const { id } = await newDeal(repA, 'Moving');
    const open = await createActivity(
      prisma,
      {
        dealId: id,
        type: 'meeting',
        subject: 'Visit',
        dueAt: new Date(Date.now() + 3600_000).toISOString(),
        done: false,
        idempotencyKey: key(),
      },
      repA,
    );
    await expect(assignDeal(prisma, id, repB.userId, repA)).rejects.toMatchObject({
      code: 'no_access',
    });
    await expect(assignDeal(prisma, id, viewer.userId, manager)).rejects.toMatchObject({
      code: 'owner_not_sales',
    });
    await assignDeal(prisma, id, repB.userId, manager);
    const deal = await getDeal(prisma, id, repB);
    expect(deal.owner?.id).toBe(repB.userId);
    expect(deal.company.ownerId).toBe(repB.userId);
    expect((await prisma.crmActivity.findUniqueOrThrow({ where: { id: open.id } })).ownerId).toBe(
      repB.userId,
    );
    await expect(getDeal(prisma, id, repA)).rejects.toMatchObject({ code: 'deal_not_allowed' });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'crm_deal.assign' } });
    expect(audit).toMatchObject({
      before: { ownerId: repA.userId },
      after: { ownerId: repB.userId },
    });
  });
});

describe('leads coming in', () => {
  it('turns a website form lead into a company, contact and deal in the queue', async () => {
    const lead = await createSiteLead(prisma, {
      name: 'Mona Adel',
      phone: '+44 20 7946 0958',
      website: 'https://www.monastore.com/shop',
      ordersBand: '300_1000',
      locale: 'ar',
      idempotencyKey: 'site-lead-0001',
    });
    const again = await createSiteLead(prisma, {
      name: 'Mona Adel',
      phone: '+44 20 7946 0958',
      website: 'https://www.monastore.com/shop',
      ordersBand: '300_1000',
      locale: 'ar',
      idempotencyKey: 'site-lead-0001',
    });
    expect(again.id).toBe(lead.id);
    const company = await prisma.crmCompany.findUniqueOrThrow({
      where: { siteLeadId: lead.id },
      include: { contacts: true, deals: true },
    });
    expect(company).toMatchObject({
      brandName: 'monastore.com',
      source: 'website_form',
      ownerId: null,
      expectedMonthlyOrders: 650,
    });
    expect(company.contacts[0]).toMatchObject({
      name: 'Mona Adel',
      phone: '+44 20 7946 0958',
      phoneValid: false,
    });
    expect(company.deals).toHaveLength(1);
    expect(company.deals[0]).toMatchObject({ stage: 'new', ownerId: null, number: 1 });
    const alert = await prisma.alert.findUniqueOrThrow({ where: { key: `site_lead:${lead.id}` } });
    expect(alert.data).toMatchObject({ dealId: company.deals[0]!.id });
    expect(await listDeals(prisma, manager, { unassigned: true })).toHaveLength(1);
    expect(await listDeals(prisma, repA)).toHaveLength(0);
  });

  it('turns a merchant sign up into a lead linked to the merchant', async () => {
    const { merchantId } = await signUpMerchant(prisma, {
      businessName: 'Nile Pantry',
      contactName: 'Hana',
      email: 'hana@nile.eg',
      phone: '+201012345678',
      password: 'very-secret-1',
      shopDomain: 'nile-pantry.myshopify.com',
    });
    const company = await prisma.crmCompany.findFirstOrThrow({
      where: { merchantId },
      include: { contacts: true, deals: true },
    });
    expect(company).toMatchObject({
      brandName: 'Nile Pantry',
      source: 'signup',
      shopDomain: 'nile-pantry.myshopify.com',
    });
    expect(company.contacts[0]).toMatchObject({ email: 'hana@nile.eg', phoneValid: true });
    expect(company.deals[0]).toMatchObject({ stage: 'new', merchantId });
  });

  it('hands leads round robin to the active reps when auto assign is on', async () => {
    const lead = (i: number) =>
      createSiteLead(prisma, {
        name: `Lead ${i}`,
        phone: '01012345678',
        website: null,
        ordersBand: 'under_300',
        locale: 'en',
        idempotencyKey: `round-robin-${i}000`,
      });
    await lead(1);
    await setSetting(prisma, { key: 'sales.auto_assign', value: 1, actorUserId: manager.userId });
    for (let i = 2; i <= 5; i++) await lead(i);
    const deals = await prisma.crmDeal.findMany({ orderBy: { number: 'asc' } });
    const reps = [repA.userId, repB.userId].sort();
    expect(deals.map((d) => d.ownerId)).toEqual([null, reps[0], reps[1], reps[0], reps[1]]);
    expect(deals.slice(1).every((d) => d.autoAssigned)).toBe(true);
    // A rep who leaves is skipped.
    await prisma.user.update({ where: { id: reps[0] }, data: { isActive: false } });
    await lead(6);
    expect((await prisma.crmDeal.findFirstOrThrow({ where: { number: 6 } })).ownerId).toBe(reps[1]);
  });
});

describe('follow ups and reminders', () => {
  it('lists my day and flags deals without a next step', async () => {
    const now = new Date('2026-11-07T08:00:00Z'); // 10:00 in Cairo
    const a = await newDeal(repA, 'Planned');
    const b = await newDeal(repA, 'Forgotten');
    const plan = (dealId: string, dueAt: string, subject: string) =>
      createActivity(
        prisma,
        { dealId, type: 'call', subject, dueAt, done: false, idempotencyKey: key() },
        repA,
        now,
      );
    await plan(a.id, '2026-11-07T06:00:00Z', 'Overdue call');
    await plan(a.id, '2026-11-07T15:00:00Z', 'Later today');
    await plan(a.id, '2026-11-08T09:00:00Z', 'Tomorrow');
    const day = await myDay(prisma, repA, {}, now);
    expect(day.overdue.map((x) => x.subject)).toEqual(['Overdue call']);
    expect(day.today.map((x) => x.subject)).toEqual(['Later today']);
    expect(day.needsNextStep.map((d) => d.id)).toEqual([b.id]);
    // A rep cannot look at another rep's day; a manager can.
    expect((await myDay(prisma, repA, { ownerId: repB.userId }, now)).ownerId).toBe(repA.userId);
    expect((await myDay(prisma, manager, { ownerId: repA.userId }, now)).overdue).toHaveLength(1);
    const card = (await listDeals(prisma, repA)).find((d) => d.id === a.id)!;
    expect(card.nextStep?.subject).toBe('Overdue call');
  });

  it('reminds once when due, alerts once when overdue and once per stale stage', async () => {
    // Alerts are stamped with the real clock, so the test's clock ends at about now.
    const t0 = new Date(Date.now() - 80 * 60_000);
    const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);
    const push = new FakePush();
    const { id } = await newDeal(repA, 'Reminders');
    await prisma.crmDeal.update({
      where: { id },
      data: { stageChangedAt: new Date(t0.getTime() - 15 * 24 * 60 * 60_000) },
    });
    const call = await createActivity(
      prisma,
      {
        dealId: id,
        type: 'call',
        subject: 'Call Hana',
        dueAt: at(10).toISOString(),
        done: false,
        idempotencyKey: key(),
      },
      repA,
      t0,
    );
    expect(await crmReminders(prisma, at(5))).toEqual({ due: 0, overdue: 0, stale: 1 });
    expect(await crmReminders(prisma, at(11))).toEqual({ due: 1, overdue: 0, stale: 0 });
    await dispatchPush(prisma, push, { now: at(12) });
    expect(await crmReminders(prisma, at(12))).toEqual({ due: 0, overdue: 0, stale: 0 });
    expect(await crmReminders(prisma, at(71))).toEqual({ due: 0, overdue: 1, stale: 0 });
    expect(await crmReminders(prisma, at(90))).toEqual({ due: 0, overdue: 0, stale: 0 });
    const alerts = await prisma.alert.findMany({ orderBy: { createdAt: 'asc' } });
    expect(alerts.map((a) => a.type)).toEqual(['crm_deal_stale', 'crm_followup_overdue']);

    // The push dispatcher tells the owner, once each.
    await dispatchPush(prisma, push, { now: at(80) });
    expect(push.to()).toEqual(['repA', 'repA', 'repA']);
    expect(push.sent.map((s) => s.message.title).sort()).toEqual([
      'Deal DEAL-000001 is stuck',
      'Follow up now: Reminders',
      'Follow up overdue: Reminders',
    ]);
    await dispatchPush(prisma, push, { now: at(81) });
    expect(push.sent).toHaveLength(3);

    // Doing the follow up and moving the deal handle their alerts.
    await completeActivity(prisma, call.id, 'She will send products', repA, at(80));
    await changeStage(prisma, id, { stage: 'contacted' }, repA, at(80));
    expect(await prisma.alert.count({ where: { resolvedAt: null } })).toBe(0);
  });

  it('tells a rep when a manager gives them a deal', async () => {
    const { id } = await newDeal(manager, 'Given');
    await assignDeal(prisma, id, repB.userId, manager);
    const push = new FakePush();
    await dispatchPush(prisma, push);
    const given = push.sent.find((s) => s.message.title === 'Deal DEAL-000001 is yours')!;
    expect(given.endpoint).toMatch(/repB$/);
    expect(given.message.body).toBe('Given: manager gave you this deal.');
  });
});

/** Records every push. */
class FakePush implements PushSender {
  enabled = true;
  sent: { endpoint: string; message: PushMessage }[] = [];
  async send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    this.sent.push({ endpoint: target.endpoint, message });
    return 'sent';
  }
  to() {
    return this.sent.map((s) => s.endpoint.replace('https://push.test/', '')).sort();
  }
}
