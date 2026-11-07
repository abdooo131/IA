import {
  addDays,
  cairoDay,
  cairoDayStart,
  JOB_ROLE_TEMPLATES,
  type JobRole,
  shiftMonth,
} from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { writeAccess } from '../src/access';
import { assignDeal, changeStage, createDeal, crmActor, type CrmActor } from '../src/crm';
import {
  acceptProposal,
  approveProposal,
  confirmProposal,
  createProposal,
  dealProposals,
  declineProposal,
  expireProposals,
  newOwnerSetupLink,
  publicProposal,
  readSetupToken,
  requestProposalApproval,
  sendProposal,
  updateProposal,
  useSetupToken,
} from '../src/crm-proposals';
import {
  adjustCommission,
  approveCommission,
  computeCommissions,
  listCommissions,
  listTargets,
  salesDashboard,
  setTarget,
} from '../src/crm-sales';
import {
  ensureDefaultAccounts,
  payslips,
  payStaffBonus,
  post,
  recordCapital,
  runPayroll,
} from '../src/finance';
import { setEmployment, setSalary } from '../src/hr-pay';
import { getMerchantSetting, setSetting } from '../src/settings';
import { prisma, resetDatabase } from './helpers';

let manager: CrmActor;
let manager2: CrmActor;
let repA: CrmActor;
let repB: CrmActor;
let n = 0;
const key = () => `crm2-key-${++n}`.padEnd(14, '0');

async function person(name: string, job: JobRole) {
  const user = await prisma.user.create({
    data: { email: `${name}@t.eg`, name, role: 'admin', passwordHash: 'x' },
  });
  const values = { ...JOB_ROLE_TEMPLATES[job], jobRole: job };
  const profile = await prisma.$transaction((tx) => writeAccess(tx, user.id, values, []));
  return crmActor(profile, user.id);
}

const newDeal = (actor: CrmActor, brandName: string) =>
  createDeal(
    prisma,
    {
      company: { brandName, source: 'manual' },
      contact: {
        name: `${brandName} owner`,
        phone: '01012345678',
        email: `${brandName.replace(/\s/g, '').toLowerCase()}@b.eg`,
      },
      expectedMonthlyOrders: 1000,
      idempotencyKey: key(),
    },
    actor,
  );

const setFee = (k: Parameters<typeof setSetting>[1]['key'], value: number) =>
  setSetting(prisma, { key: k, value, actorUserId: null });

beforeEach(async () => {
  await resetDatabase();
  manager = await person('manager', 'sales_manager');
  manager2 = await person('manager2', 'sales_manager');
  repA = await person('repA', 'sales_rep');
  repB = await person('repB', 'sales_rep');
  await setFee('fee.order_fixed_piastres', 2000);
  await setFee('fee.order_percent_bp', 100);
  await setFee('fee.cod_percent_bp', 150);
  await setFee('fee.failed_delivery_piastres', 1500);
});

afterAll(() => prisma.$disconnect());

/** A deal taken to an accepted proposal, ready to confirm. */
async function acceptedDeal(actor: CrmActor, brand: string, extra = {}) {
  const deal = await newDeal(actor, brand);
  const proposal = await createProposal(
    prisma,
    {
      dealId: deal.id,
      idempotencyKey: key(),
      tiers: [{ fromOrder: 501, fixedFeePiastres: 1800, percentBp: null }],
      minimumMonthlyFeePiastres: 1_000_000,
      securityDepositPiastres: 500_000,
      creditLimitPiastres: 2_000_000,
      contractStartDate: '2026-12-01',
      contractMonths: 12,
      noticeDays: 60,
      ...extra,
    },
    actor,
  );
  const sent = await sendProposal(prisma, proposal.id, actor);
  await acceptProposal(prisma, sent.token!, { signerName: 'Sara Brand', signerTitle: 'CEO' });
  return { deal, proposal: sent };
}

describe('proposals', () => {
  it('numbers proposals without gaps, starts from the fee settings and supersedes old versions', async () => {
    const deal = await newDeal(repA, 'Nile Shoes');
    const first = await createProposal(prisma, { dealId: deal.id, idempotencyKey: key() }, repA);
    expect(first).toMatchObject({
      label: 'PRO-000001',
      version: 1,
      status: 'draft',
      expectedMonthlyOrders: 1000,
      fees: { orderFixedPiastres: 2000, orderPercentBp: 100, codPercentBp: 150 },
      needsApproval: false,
    });
    const again = await createProposal(
      prisma,
      { dealId: deal.id, idempotencyKey: key(), orderFixedPiastres: 1900 },
      repA,
    );
    expect(again).toMatchObject({ label: 'PRO-000002', version: 2, maxDiscountBp: 500 });
    const list = await dealProposals(prisma, deal.id, repA);
    expect(list.proposals.map((p) => [p.version, p.status])).toEqual([
      [2, 'draft'],
      [1, 'superseded'],
    ]);
    // Concurrent proposals on other deals still number without gaps.
    const others = await Promise.all(['A', 'B', 'C'].map((b) => newDeal(repA, `Brand ${b}`)));
    await Promise.all(
      others.map((d) => createProposal(prisma, { dealId: d.id, idempotencyKey: key() }, repA)),
    );
    const numbers = (await prisma.crmProposal.findMany()).map((p) => p.number).sort();
    expect(numbers).toEqual([1, 2, 3, 4, 5]);
    // A rep never touches another rep's deal.
    await expect(
      createProposal(prisma, { dealId: deal.id, idempotencyKey: key() }, repB),
    ).rejects.toThrow('deal_not_allowed');
  });

  it('needs a sales manager for a discount past the limit, never the person who made it', async () => {
    const deal = await newDeal(repA, 'Cairo Tea');
    // 1,500 against 2,000 is 25% off; the limit is 20%.
    const draft = await createProposal(
      prisma,
      { dealId: deal.id, idempotencyKey: key(), orderFixedPiastres: 1500 },
      repA,
    );
    expect(draft).toMatchObject({ needsApproval: true, maxDiscountBp: 2500 });
    await expect(sendProposal(prisma, draft.id, repA)).rejects.toThrow('approval_required');
    await expect(approveProposal(prisma, draft.id, repA)).rejects.toThrow('no_access');
    await requestProposalApproval(prisma, draft.id, repA);
    await approveProposal(prisma, draft.id, manager);
    // A new price is a new question.
    await updateProposal(prisma, draft.id, { orderFixedPiastres: 1400 }, repA);
    await expect(sendProposal(prisma, draft.id, repA)).rejects.toThrow('approval_required');
    await approveProposal(prisma, draft.id, manager);
    const sent = await sendProposal(prisma, draft.id, repA);
    expect(sent.status).toBe('sent');
    expect(sent.token).toHaveLength(32);
    // A tier's fee counts too; the manager's own proposal needs another manager.
    const mine = await newDeal(manager, 'Manager deal');
    const own = await createProposal(
      prisma,
      {
        dealId: mine.id,
        idempotencyKey: key(),
        tiers: [{ fromOrder: 100, fixedFeePiastres: 500, percentBp: null }],
      },
      manager,
    );
    expect(own.needsApproval).toBe(true);
    await expect(approveProposal(prisma, own.id, manager)).rejects.toThrow('same_person');
    await approveProposal(prisma, own.id, manager2);
  });

  it('sends a link, moves the deal to proposal, marks it viewed once and takes the answer', async () => {
    const deal = await newDeal(repA, 'Delta Home');
    const draft = await createProposal(prisma, { dealId: deal.id, idempotencyKey: key() }, repA);
    const sent = await sendProposal(prisma, draft.id, repA);
    const fresh = await prisma.crmDeal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(fresh.stage).toBe('proposal');
    expect(sent.validUntil).toBe(addDays(cairoDay(new Date()), 14));
    const view = await publicProposal(prisma, sent.token!);
    expect(view).toMatchObject({ status: 'viewed', brand: 'Delta Home', label: 'PRO-000001' });
    // 1,000 orders a month without an average value: 20 EGP each.
    expect(view.example.totalPiastres).toBe(2_000_000);
    const viewedAt = (await prisma.crmProposal.findUniqueOrThrow({ where: { id: draft.id } }))
      .viewedAt;
    await publicProposal(prisma, sent.token!);
    expect(
      (await prisma.crmProposal.findUniqueOrThrow({ where: { id: draft.id } })).viewedAt,
    ).toEqual(viewedAt);
    await declineProposal(prisma, sent.token!, { signerName: 'Omar', reason: 'Too dear' });
    await expect(
      acceptProposal(prisma, sent.token!, { signerName: 'Omar', signerTitle: 'Owner' }),
    ).rejects.toThrow('proposal_closed');
    await expect(publicProposal(prisma, 'no-such-token')).rejects.toThrow('proposal_not_found');
  });

  it('refuses an answer once the proposal has run out', async () => {
    const deal = await newDeal(repA, 'Old Offer');
    const draft = await createProposal(prisma, { dealId: deal.id, idempotencyKey: key() }, repA);
    const sent = await sendProposal(prisma, draft.id, repA);
    const later = new Date(Date.now() + 20 * 24 * 60 * 60_000);
    await expect(
      acceptProposal(prisma, sent.token!, { signerName: 'Late', signerTitle: 'CEO' }, later),
    ).rejects.toThrow('proposal_expired');
    expect((await expireProposals(prisma, later)).expired).toBe(1);
    expect((await publicProposal(prisma, sent.token!, later)).status).toBe('expired');
  });

  it('confirming opens the merchant, its owner, contract and fees in one go, once', async () => {
    const { deal, proposal } = await acceptedDeal(repA, 'Zamalek Beauty', {
      orderFixedPiastres: 1700,
    });
    // Nothing is made before the rep confirms; another rep cannot confirm.
    await expect(confirmProposal(prisma, proposal.id, {}, repB)).rejects.toThrow(
      'deal_not_allowed',
    );
    const result = await confirmProposal(prisma, proposal.id, {}, repA);
    expect(result.setupToken).toBeTruthy();
    const merchant = await prisma.merchant.findUniqueOrThrow({
      where: { id: result.merchantId },
      include: {
        users: true,
        contract: { include: { tiers: true } },
        crmCompanies: true,
      },
    });
    expect(merchant).toMatchObject({
      name: 'Zamalek Beauty',
      approval: 'approved',
      isActive: true,
      accountManagerId: repA.userId,
    });
    expect(merchant.users).toEqual([
      expect.objectContaining({
        email: 'zamalekbeauty@b.eg',
        role: 'merchant',
        merchantRole: 'owner',
        isActive: false,
      }),
    ]);
    expect(merchant.contract).toMatchObject({
      noticeDays: 60,
      minimumMonthlyFeePiastres: 1_000_000,
      securityDepositPiastres: 500_000,
      creditLimitPiastres: 2_000_000,
    });
    expect(merchant.contract!.startDate.toISOString().slice(0, 10)).toBe('2026-12-01');
    expect(merchant.contract!.endDate!.toISOString().slice(0, 10)).toBe('2027-11-30');
    expect(merchant.contract!.tiers).toEqual([
      expect.objectContaining({ fromOrder: 501, fixedFeePiastres: 1800, percentBp: null }),
    ]);
    expect(merchant.crmCompanies).toHaveLength(1);
    expect(await getMerchantSetting(prisma, 'fee.order_fixed_piastres', merchant.id)).toBe(1700);
    expect(await getMerchantSetting(prisma, 'fee.failed_delivery_piastres', merchant.id)).toBe(
      1500,
    );
    const won = await prisma.crmDeal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(won).toMatchObject({
      stage: 'won',
      merchantId: merchant.id,
      wonById: repA.userId,
      commissionBp: 500,
      commissionMonths: 12,
      qualifyMonths: 2,
    });
    const audits = await prisma.auditLog.findMany({ where: { entityId: merchant.id } });
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(['merchant.create', 'merchant.contract_create']),
    );
    // Again: nothing new.
    const twice = await confirmProposal(prisma, proposal.id, {}, repA);
    expect(twice).toMatchObject({ merchantId: merchant.id, setupToken: null, again: true });
    expect(await prisma.merchant.count()).toBe(1);
    // A won deal with its merchant never leaves won.
    await expect(changeStage(prisma, deal.id, { stage: 'negotiation' }, manager)).rejects.toThrow(
      'deal_won_locked',
    );
    // The owner chooses a password through the one time link.
    expect(await readSetupToken(prisma, result.setupToken!)).toMatchObject({
      merchant: 'Zamalek Beauty',
    });
    await useSetupToken(prisma, result.setupToken!, 'a-good-long-password');
    expect(
      (await prisma.user.findFirstOrThrow({ where: { merchantId: merchant.id } })).isActive,
    ).toBe(true);
    await expect(useSetupToken(prisma, result.setupToken!, 'another-password')).rejects.toThrow(
      'setup_link_invalid',
    );
    await expect(newOwnerSetupLink(prisma, deal.id, repA)).rejects.toThrow('owner_already_active');
  });

  it('confirms nothing at all when a part fails', async () => {
    await prisma.user.create({
      data: { email: 'taken@b.eg', name: 'Someone', role: 'admin', passwordHash: 'x' },
    });
    const { deal, proposal } = await acceptedDeal(repA, 'Rollback Co');
    await expect(
      confirmProposal(prisma, proposal.id, { ownerEmail: 'taken@b.eg' }, repA),
    ).rejects.toThrow('email_taken');
    expect(await prisma.merchant.count()).toBe(0);
    expect(await prisma.merchantContract.count()).toBe(0);
    expect((await prisma.crmDeal.findUniqueOrThrow({ where: { id: deal.id } })).stage).toBe(
      'proposal',
    );
    const ok = await confirmProposal(prisma, proposal.id, { ownerEmail: 'free@b.eg' }, repA);
    expect(ok.merchantId).toBeTruthy();
  });
});

// ─── targets, commission, payroll ───────────────────────────────────────────────

const thisMonth = cairoDay(new Date()).slice(0, 7);
const wonMonth = shiftMonth(thisMonth, -8);
const at = (month: string, day: string) => cairoDayStart(`${month}-${day}`);

async function feeBooked(merchantId: string, when: Date, amount: number) {
  await post(prisma, {
    kind: 'order_fee',
    idempotencyKey: key(),
    occurredAt: when,
    merchantId,
    lines: [
      { account: { type: 'merchant', merchantId }, amount },
      { account: { type: 'revenue' }, amount: -amount },
    ],
  });
}

let on = 0;
async function deliveredOrder(merchantId: string, when: Date) {
  on++;
  await prisma.order.create({
    data: {
      number: `SN-${5000 + on}`,
      merchantId,
      darkStoreId: (await store()).id,
      status: 'delivered',
      customerName: 'Mona',
      customerPhone: '+201001234567',
      addressText: 'Maadi',
      deliveryOtp: '1234',
      trackingToken: `crm2-${on}`,
      paymentMethod: 'cod',
      subtotalPiastres: 10_000,
      placedAt: when,
      deliveredAt: when,
      createdAt: when,
    },
  });
}
let storeId: string | null = null;
async function store() {
  if (storeId) return { id: storeId };
  await prisma.governorate.create({
    data: { id: 1, code: 'EG-C', nameEn: 'Cairo', nameAr: 'القاهرة' },
  });
  const s = await prisma.darkStore.create({
    data: {
      code: 'TST',
      nameEn: 'Test',
      nameAr: 'تجربة',
      addressEn: 'x',
      addressAr: 'x',
      governorateId: 1,
      latitude: 30,
      longitude: 31,
    },
  });
  storeId = s.id;
  return s;
}

/**
 * repA wins a merchant on the 10th of wonMonth; fees of `fee` (1,000 EGP) on the 15th of each
 * month after, up to the running month.
 */
async function wonMerchant(brand = 'Won Brand', fee = 100_000) {
  const { deal, proposal } = await acceptedDeal(repA, brand);
  const { merchantId } = await confirmProposal(prisma, proposal.id, {}, repA);
  await prisma.crmDeal.update({
    where: { id: deal.id },
    data: { wonAt: at(wonMonth, '10') },
  });
  // A fee before the win is not the rep's.
  await feeBooked(merchantId, at(wonMonth, '05'), 50_000);
  for (let i = 0; i <= 8; i++) await feeBooked(merchantId, at(shiftMonth(wonMonth, i), '15'), fee);
  return { deal, merchantId };
}

/** One delivered order in each of these months after the win (the 20th). */
async function activeIn(merchantId: string, offsets: number[]) {
  for (const i of offsets) await deliveredOrder(merchantId, at(shiftMonth(wonMonth, i), '20'));
}

const revenueTarget = (month: string, feeRevenuePiastres: number) =>
  setTarget(
    prisma,
    { userId: repA.userId, month, dealsWon: 0, orders: 0, feeRevenuePiastres },
    manager,
  );

beforeEach(() => {
  storeId = null;
});

describe('targets and the dashboard', () => {
  it('counts what each rep brought in from qualified merchants, against targets', async () => {
    const { merchantId } = await wonMerchant();
    const month = shiftMonth(wonMonth, 1);
    await deliveredOrder(merchantId, at(month, '03'));
    await deliveredOrder(merchantId, at(month, '04'));
    await deliveredOrder(merchantId, at(shiftMonth(month, 1), '04'));
    await expect(
      setTarget(
        prisma,
        { userId: repA.userId, month, dealsWon: 2, orders: 4, feeRevenuePiastres: 200_000 },
        repA,
      ),
    ).rejects.toThrow('no_access');
    await setTarget(
      prisma,
      { userId: repA.userId, month, dealsWon: 2, orders: 4, feeRevenuePiastres: 200_000 },
      manager,
    );
    // The first active month: the merchant is pending (1 of 2), its fees do not count yet.
    const rows = (await listTargets(prisma, manager, month)).rows;
    const a = rows.find((r) => r.user.id === repA.userId)!;
    expect(a.actual).toEqual({ dealsWon: 0, orders: 2, feeRevenuePiastres: 0 });
    expect(a.progress).toEqual({ dealsWon: 0, orders: 5000, feeRevenue: 0 });
    expect(a.commission).toMatchObject({
      outcome: 'missed',
      revenuePiastres: 0,
      neededPiastres: 200_000,
      qualified: 0,
      pending: [{ company: 'Won Brand', activeMonths: 1, qualifyMonths: 2 }],
    });
    // The second active month: it qualifies and its fees count from this month on.
    const next = (await listTargets(prisma, repA, shiftMonth(month, 1))).rows;
    expect(next[0]!.actual).toEqual({ dealsWon: 0, orders: 1, feeRevenuePiastres: 100_000 });
    expect(next[0]!.commission).toMatchObject({
      outcome: 'no_target',
      potentialPiastres: 5_000,
      commissionPiastres: 0,
      qualified: 1,
      pending: [],
    });
    // The win month counts the deal; the merchant was not active yet.
    const first = (await listTargets(prisma, repA, wonMonth)).rows;
    expect(first).toHaveLength(1);
    expect(first[0]!.actual).toEqual({ dealsWon: 1, orders: 0, feeRevenuePiastres: 0 });
    expect(first[0]!.commission.pending).toEqual([
      expect.objectContaining({ activeMonths: 0, qualifyMonths: 2 }),
    ]);
    const board = await salesDashboard(prisma, repA, { month: wonMonth });
    expect(board.won).toBe(1);
    expect(board.leaderboard).toHaveLength(1);
    const all = await salesDashboard(prisma, manager, { month: thisMonth });
    expect(all.funnel[0]).toMatchObject({ stage: 'new' });
    expect(all.leaderboard.length).toBeGreaterThanOrEqual(4);
  });

  it('shows managers the reps without a fees target this month and next', async () => {
    const next = shiftMonth(thisMonth, 1);
    await revenueTarget(thisMonth, 100_000);
    const { missingTargets } = await listTargets(prisma, manager, thisMonth);
    expect(missingTargets).toEqual([
      { month: thisMonth, users: [{ id: repB.userId, name: 'repB' }] },
      {
        month: next,
        users: [
          { id: repA.userId, name: 'repA' },
          { id: repB.userId, name: 'repB' },
        ],
      },
    ]);
    expect((await listTargets(prisma, repA, thisMonth)).missingTargets).toEqual([]);
  });
});

describe('commission', () => {
  it('counts a merchant from its second active month, within its months, against the target', async () => {
    const { deal, merchantId } = await wonMerchant();
    // Given to someone else after the win: the commission stays with repA.
    await assignDeal(prisma, deal.id, repB.userId, manager);
    // The terms frozen at the win: 6 months here (the win month is month 1).
    await prisma.crmDeal.update({ where: { id: deal.id }, data: { commissionMonths: 6 } });
    // A delivery before the win does not make the merchant active; then active in months 2 and 4.
    await deliveredOrder(merchantId, at(wonMonth, '05'));
    await activeIn(merchantId, [2, 4]);
    for (let i = 0; i <= 7; i++) await revenueTarget(shiftMonth(wonMonth, i), 100_000);
    for (let i = 0; i <= 7; i++)
      await computeCommissions(prisma, new Date(), shiftMonth(wonMonth, i));
    const rows = await prisma.crmCommission.findMany({
      orderBy: { month: 'asc' },
      include: { lines: true },
    });
    expect(
      rows.map((r) => [
        r.userId,
        r.month,
        r.outcome,
        r.revenuePiastres,
        r.amountPiastres,
        r.status,
      ]),
    ).toEqual([
      // Pending (not active for two months yet): its fees do not count, not even later.
      ...[0, 1, 2, 3].map((i) => [repA.userId, shiftMonth(wonMonth, i), 'missed', 0, 0, 'closed']),
      // Qualified in month 5 (the second active month): 5% of all counted fees.
      ...[4, 5].map((i) => [repA.userId, shiftMonth(wonMonth, i), 'hit', 100_000, 5_000, 'draft']),
      // Past the deal's six months: nothing counts any more.
      ...[6, 7].map((i) => [repA.userId, shiftMonth(wonMonth, i), 'missed', 0, 0, 'closed']),
    ]);
    expect(rows.map((r) => r.lines.map((l) => [l.qualified, l.activeMonths]))).toEqual([
      [[false, 0]],
      [[false, 0]],
      [[false, 1]],
      [[false, 1]],
      [[true, 2]],
      [[true, 2]],
      [],
      [],
    ]);
    expect(rows[4]!.lines[0]).toMatchObject({
      qualifiedMonth: shiftMonth(wonMonth, 4),
      monthIndex: 5,
      feesPiastres: 100_000,
      rateBp: 500,
      amountPiastres: 5_000,
    });
    // Again: nothing new.
    expect((await computeCommissions(prisma, new Date(), wonMonth)).created).toBe(0);
    await expect(computeCommissions(prisma, new Date(), thisMonth)).rejects.toThrow(
      'month_not_over',
    );
    // A rep sees only their own; a closed month cannot be approved.
    expect((await listCommissions(prisma, repB)).commissions).toHaveLength(0);
    expect((await listCommissions(prisma, repA)).commissions).toHaveLength(8);
    await expect(approveCommission(prisma, rows[0]!.id, manager)).rejects.toThrow(
      'commission_not_draft',
    );
  });

  it('pays the frozen rate of each deal on all counted fees on a hit, nothing on a miss or without a target', async () => {
    const first = await wonMerchant('First Brand', 100_000);
    await setFee('sales.commission_bp', 1000);
    const second = await wonMerchant('Second Brand', 300_000);
    expect(
      (await prisma.crmDeal.findUniqueOrThrow({ where: { id: second.deal.id } })).commissionBp,
    ).toBe(1000);
    await activeIn(first.merchantId, [1, 2]);
    await activeIn(second.merchantId, [1, 2]);
    const hit = shiftMonth(wonMonth, 3);
    const miss = shiftMonth(wonMonth, 4);
    const none = shiftMonth(wonMonth, 5);
    await revenueTarget(hit, 400_000);
    await revenueTarget(miss, 400_001);
    for (const m of [hit, miss, none]) await computeCommissions(prisma, new Date(), m);
    const rows = await prisma.crmCommission.findMany({
      orderBy: { month: 'asc' },
      include: { lines: { orderBy: { rateBp: 'asc' } } },
    });
    expect(rows.map((r) => [r.month, r.outcome, r.status])).toEqual([
      [hit, 'hit', 'draft'],
      [miss, 'missed', 'closed'],
      [none, 'no_target', 'closed'],
    ]);
    // Hit (counted 400,000 >= target 400,000): 5% of 100,000 and 10% of 300,000.
    expect(rows[0]).toMatchObject({
      revenuePiastres: 400_000,
      targetPiastres: 400_000,
      computedPiastres: 35_000,
      amountPiastres: 35_000,
    });
    expect(rows[0]!.lines.map((l) => [l.rateBp, l.feesPiastres, l.amountPiastres])).toEqual([
      [500, 100_000, 5_000],
      [1000, 300_000, 30_000],
    ]);
    // Missed by one piastre: 0, with the figures kept.
    expect(rows[1]).toMatchObject({
      revenuePiastres: 400_000,
      targetPiastres: 400_001,
      computedPiastres: 0,
      amountPiastres: 0,
    });
    expect(rows[1]!.lines.map((l) => l.amountPiastres)).toEqual([0, 0]);
    // No target set: 0.
    expect(rows[2]).toMatchObject({ revenuePiastres: 400_000, targetPiastres: null });
    const listed = await listCommissions(prisma, manager);
    expect(listed.commissions.find((c) => c.month === miss)).toMatchObject({
      outcome: 'missed',
      status: 'closed',
    });
  });

  it('estimates the running month: counted so far, what is still needed, what it would pay', async () => {
    const { merchantId } = await wonMerchant();
    await activeIn(merchantId, [7, 8]);
    await revenueTarget(thisMonth, 150_000);
    // Seen near the end of the month, so the fees and orders booked in it are in.
    const { estimate } = await listCommissions(prisma, repA, {}, at(thisMonth, '28'));
    expect(estimate).toEqual([
      expect.objectContaining({
        user: { id: repA.userId, name: 'repA' },
        month: thisMonth,
        outcome: 'missed',
        revenuePiastres: 100_000,
        targetPiastres: 150_000,
        neededPiastres: 50_000,
        progressBp: 6667,
        potentialPiastres: 5_000,
        commissionPiastres: 0,
        pending: [],
      }),
    ]);
  });

  it('is approved or adjusted by another sales manager and paid once in the salary run', async () => {
    const { merchantId } = await wonMerchant();
    await activeIn(merchantId, [0, 1]);
    await revenueTarget(shiftMonth(wonMonth, 1), 100_000);
    await revenueTarget(shiftMonth(wonMonth, 2), 100_000);
    await ensureDefaultAccounts(prisma);
    const bank = await prisma.ledgerAccount.findUniqueOrThrow({ where: { key: 'bank' } });
    await recordCapital(prisma, {
      direction: 'in',
      moneyAccountId: bank.id,
      amountPiastres: 50_000_000,
      reference: 'Owner',
      actorUserId: manager.userId,
      idempotencyKey: key(),
    });
    // The win month: pending and no target, closed at 0, never paid.
    await computeCommissions(prisma, new Date(), wonMonth);
    await computeCommissions(prisma, new Date(), shiftMonth(wonMonth, 1));
    await computeCommissions(prisma, new Date(), shiftMonth(wonMonth, 2));
    const [closed, c0, c1] = await prisma.crmCommission.findMany({ orderBy: { month: 'asc' } });
    expect(closed).toMatchObject({ status: 'closed', outcome: 'no_target', amountPiastres: 0 });
    expect([c0!.status, c0!.amountPiastres, c1!.amountPiastres]).toEqual(['draft', 5_000, 5_000]);
    await expect(approveCommission(prisma, c0!.id, repA)).rejects.toThrow('no_access');
    await expect(
      adjustCommission(prisma, c1!.id, { amountPiastres: 7_000, reason: 'Big launch' }, manager),
    ).resolves.toMatchObject({ amountPiastres: 7_000, computedPiastres: 5_000 });
    await approveCommission(prisma, c0!.id, manager);
    await expect(
      adjustCommission(prisma, c0!.id, { amountPiastres: 1, reason: 'Late change' }, manager),
    ).rejects.toThrow('commission_not_draft');
    await expect(
      adjustCommission(prisma, closed!.id, { amountPiastres: 1, reason: 'Kind' }, manager),
    ).rejects.toThrow('commission_not_draft');

    await setSalary(prisma, {
      userId: repA.userId,
      monthlyPiastres: 1_000_000,
      actorUserId: manager.userId,
    });
    const payMonth = shiftMonth(wonMonth, 1);
    await runPayroll(prisma, {
      month: payMonth,
      moneyAccountId: bank.id,
      lines: [{ userId: repA.userId }],
      actorUserId: manager.userId,
    });
    const [slip] = (await payslips(prisma, payMonth)).people;
    expect(slip).toMatchObject({ base: 1_000_000, commission: 5_000, gross: 1_005_000 });
    expect(await prisma.crmCommission.findUniqueOrThrow({ where: { id: c0!.id } })).toMatchObject({
      status: 'paid',
      paidVia: 'payroll',
    });
    expect(
      await prisma.crmCommission.findUniqueOrThrow({ where: { id: closed!.id } }),
    ).toMatchObject({ status: 'closed', paidEntryId: null });
    // The next run takes only what was approved since.
    await approveCommission(prisma, c1!.id, manager);
    const next = shiftMonth(payMonth, 1);
    await runPayroll(prisma, {
      month: next,
      moneyAccountId: bank.id,
      lines: [{ userId: repA.userId }],
      actorUserId: manager.userId,
    });
    expect((await payslips(prisma, next)).people[0]).toMatchObject({ commission: 7_000 });
    const later = shiftMonth(next, 1);
    await runPayroll(prisma, {
      month: later,
      moneyAccountId: bank.id,
      lines: [{ userId: repA.userId }],
      actorUserId: manager.userId,
    });
    expect((await payslips(prisma, later)).people[0]).toMatchObject({ commission: 0 });
  });

  it('pays an outsourced rep as a direct bonus, once; a manager never approves their own', async () => {
    const { merchantId } = await wonMerchant();
    await activeIn(merchantId, [0, 1]);
    await revenueTarget(shiftMonth(wonMonth, 1), 100_000);
    await ensureDefaultAccounts(prisma);
    const bank = await prisma.ledgerAccount.findUniqueOrThrow({ where: { key: 'bank' } });
    await recordCapital(prisma, {
      direction: 'in',
      moneyAccountId: bank.id,
      amountPiastres: 1_000_000,
      reference: 'Owner',
      actorUserId: manager.userId,
      idempotencyKey: key(),
    });
    const agency = await prisma.supplier.create({
      data: { name: 'Agency', createdById: manager.userId },
    });
    await setEmployment(prisma, {
      userId: repA.userId,
      employment: 'outsourced',
      staffingSupplierId: agency.id,
      actorUserId: manager.userId,
    });
    await computeCommissions(prisma, new Date(), shiftMonth(wonMonth, 1));
    const c = await prisma.crmCommission.findFirstOrThrow();
    expect(c).toMatchObject({ status: 'draft', amountPiastres: 5_000 });
    await approveCommission(prisma, c.id, manager);
    const pay = () =>
      payStaffBonus(prisma, {
        userId: repA.userId,
        amountPiastres: 5_000,
        commissionId: c.id,
        moneyAccountId: bank.id,
        reference: 'Commission',
        actorUserId: manager.userId,
        idempotencyKey: key(),
      });
    await pay();
    expect(await prisma.crmCommission.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({
      status: 'paid',
      paidVia: 'bonus',
    });
    await expect(pay()).rejects.toThrow('commission_not_payable');

    // A manager's own commission waits for another manager.
    const own = await prisma.crmCommission.create({
      data: {
        userId: manager.userId,
        month: wonMonth,
        computedPiastres: 100,
        amountPiastres: 100,
        idempotencyKey: `commission:${manager.userId}:${wonMonth}`,
      },
    });
    await expect(approveCommission(prisma, own.id, manager)).rejects.toThrow('same_person');
    await approveCommission(prisma, own.id, manager2);
  });
});
