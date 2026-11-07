import type { Prisma } from '@prisma/client';
import {
  addDays,
  cairoDay,
  cairoDayStart,
  type CommissionAdjustBody,
  commissionMonthIndex,
  commissionOn,
  type CommissionOutcome,
  commissionOutcome,
  CRM_OPEN_STAGES,
  CRM_SOURCES,
  CRM_STAGES,
  dealNumber,
  funnel,
  progressBp,
  qualifyingMonth,
  shiftMonth,
  targetGap,
  type TargetBody,
} from '@shiplynow/shared';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { activityScope, type CrmActor, dealScope, need, salesPeople } from './crm';
import { DomainError } from './domain-error';
import { getSetting } from './settings';

type Tx = Prisma.TransactionClient;

// Sales CRM part 2 (docs/SALES.md 9 to 11): what each rep brought in, against their targets,
// the sales dashboard, and commission on the fees of the merchants they won.
//
// A rep is credited with a merchant through the deal they won (crm_deals.won_by_id, the owner
// at the moment of the win), from the moment it was won. A merchant won twice counts for its
// first win only. Its fees (fee income before VAT booked to it in the ledger: revenue lines
// tagged with the merchant, the year close left out) count toward the rep's fees target and
// commission only once the merchant is active (a delivered order) in the number of distinct
// Cairo months frozen on the deal (sales.qualify_active_months, 2), from the month it reaches
// that on, and only within the deal's commission months (sales.commission_months, the win month
// first; 0 means no end). Once a month is over the rep's counted fees are compared with their
// fees target: at or above a target above 0 they earn each deal's rate on all the counted fees,
// otherwise nothing that month.

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthStart = (month: string) => cairoDayStart(`${month}-01`);
const monthRange = (month: string) => {
  if (!MONTH.test(month)) throw new DomainError('invalid_month', 400);
  return { from: monthStart(month), to: monthStart(shiftMonth(month, 1)) };
};
const num = (v: bigint | number | null | undefined) => Number(v ?? 0);

/** Who the numbers are for: managers see everyone (or one rep), anyone else only themselves. */
function whoFor(actor: CrmActor, ownerId?: string | null) {
  if (actor.level === 'manage') return ownerId || null;
  return actor.userId;
}

// ─── counted fees and commission per rep and month ─────────────────────────────────

/** Merchants won with their commission terms: the first win of each merchant. */
async function commissionDeals(db: Db, userId: string | null) {
  const deals = await db.crmDeal.findMany({
    where: {
      stage: 'won',
      merchantId: { not: null },
      wonById: userId ?? { not: null },
      wonAt: { not: null },
    },
    select: {
      id: true,
      number: true,
      merchantId: true,
      wonById: true,
      wonAt: true,
      commissionBp: true,
      commissionMonths: true,
      qualifyMonths: true,
      company: { select: { brandName: true } },
    },
    orderBy: { wonAt: 'asc' },
  });
  const seen = new Set<string>();
  return deals.filter((d) => {
    if (seen.has(d.merchantId!)) return false;
    seen.add(d.merchantId!);
    return true;
  });
}

/** Fees before VAT booked to a merchant between two moments. */
async function merchantFees(db: Db, merchantId: string, from: Date, to: Date) {
  const rows = await db.$queryRaw<{ fees: bigint | null }[]>`
    SELECT -SUM(l.amount_piastres) AS fees FROM ledger_lines l
      JOIN ledger_accounts a ON a.id = l.account_id
      JOIN ledger_entries e ON e.id = l.entry_id
    WHERE a.type = 'revenue' AND e.kind <> 'year_close' AND l.merchant_id = ${merchantId}
      AND l.occurred_at >= ${from} AND l.occurred_at < ${to}`;
  return num(rows[0]?.fees);
}

/** The distinct Cairo months (YYYY-MM) in which a merchant had a delivered order. */
async function activeMonths(db: Db, merchantId: string, from: Date, to: Date) {
  const rows = await db.$queryRaw<{ month: string }[]>`
    SELECT DISTINCT to_char(delivered_at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo', 'YYYY-MM')
      AS month FROM orders
    WHERE merchant_id = ${merchantId} AND status = 'delivered'
      AND delivered_at >= ${from} AND delivered_at < ${to}
    ORDER BY month`;
  return rows.map((r) => r.month);
}

/** One won merchant in a rep's month. */
export interface CommissionLineFigures {
  dealId: string;
  label: string;
  company: string;
  merchantId: string;
  /** 1 is the month the deal was won */
  monthIndex: number;
  /** false: still pending, its fees do not count yet */
  qualified: boolean;
  /** Distinct months with a delivered order since the win, up to the month's end (or now) */
  activeMonths: number;
  /** The months it needs (frozen on the deal at the win) */
  qualifyMonths: number;
  qualifiedMonth: string | null;
  feesPiastres: number;
  rateBp: number;
  /** The deal's rate on its fees: what the line pays when the target is hit */
  amountPiastres: number;
}

/** A rep's month: counted fees against the fees target, and what it pays. */
export interface RepMonth {
  userId: string;
  month: string;
  /** Fees of the qualified merchants inside their commission months */
  revenuePiastres: number;
  targetPiastres: number | null;
  outcome: CommissionOutcome;
  progressBp: number | null;
  /** How much more counted fees hit the target (null without one) */
  neededPiastres: number | null;
  /** Each deal's rate on its counted fees: what the month pays if the target is hit */
  potentialPiastres: number;
  /** What the month pays at the current level: the potential when hit, else 0 */
  commissionPiastres: number;
  lines: CommissionLineFigures[];
  pending: CommissionLineFigures[];
}

const emptyRepMonth = (userId: string, month: string, target: number | null): RepMonth => ({
  userId,
  month,
  revenuePiastres: 0,
  targetPiastres: target,
  outcome: commissionOutcome(0, target),
  progressBp: progressBp(0, target),
  neededPiastres: targetGap(0, target),
  potentialPiastres: 0,
  commissionPiastres: 0,
  lines: [],
  pending: [],
});

/**
 * Each rep's month (up to now for the running month): one line per merchant whose deal they
 * won while the month is within the deal's commission months. A merchant qualifies in the nth
 * distinct month it had a delivered order since the win; from then on its fees count, before
 * that it is pending. Reps with a won merchant in the window or a fees target show.
 */
export async function repMonths(
  db: Db,
  month: string,
  userId: string | null = null,
  now: Date = new Date(),
): Promise<Map<string, RepMonth>> {
  const { from, to } = monthRange(month);
  const until = to < now ? to : now;
  const [deals, targets, defaults] = await Promise.all([
    commissionDeals(db, userId),
    db.crmTarget.findMany({
      where: { month, ...(userId ? { userId } : {}) },
      select: { userId: true, feeRevenuePiastres: true },
    }),
    Promise.all([
      getSetting(db, 'sales.commission_bp'),
      getSetting(db, 'sales.commission_months'),
      getSetting(db, 'sales.qualify_active_months'),
    ]),
  ]);
  const targetOf = new Map(targets.map((t) => [t.userId, t.feeRevenuePiastres]));
  const out = new Map<string, RepMonth>();
  const rep = (id: string) => {
    if (!out.has(id)) out.set(id, emptyRepMonth(id, month, targetOf.get(id) ?? null));
    return out.get(id)!;
  };
  for (const t of targets) rep(t.userId);

  for (const d of deals) {
    if (d.wonAt! >= to) continue;
    // Deals won before these terms existed take today's settings.
    const rateBp = d.commissionBp ?? defaults[0];
    const months = d.commissionMonths ?? defaults[1];
    const needed = d.qualifyMonths ?? defaults[2];
    const index = commissionMonthIndex(cairoDay(d.wonAt!).slice(0, 7), month, months);
    if (index === null) continue;
    const active = await activeMonths(db, d.merchantId!, d.wonAt!, until);
    const qualifiedMonth = qualifyingMonth(active, needed);
    const qualified = qualifiedMonth !== null && qualifiedMonth <= month;
    const start = d.wonAt! > from ? d.wonAt! : from;
    const fees = Math.max(0, await merchantFees(db, d.merchantId!, start, until));
    const line: CommissionLineFigures = {
      dealId: d.id,
      label: dealNumber(d.number),
      company: d.company.brandName,
      merchantId: d.merchantId!,
      monthIndex: index,
      qualified,
      activeMonths: active.length,
      qualifyMonths: needed,
      qualifiedMonth,
      feesPiastres: fees,
      rateBp,
      amountPiastres: qualified ? commissionOn(fees, rateBp) : 0,
    };
    const r = rep(d.wonById!);
    if (qualified) r.lines.push(line);
    else r.pending.push(line);
  }

  for (const r of out.values()) {
    r.revenuePiastres = r.lines.reduce((s, l) => s + l.feesPiastres, 0);
    r.potentialPiastres = r.lines.reduce((s, l) => s + l.amountPiastres, 0);
    r.outcome = commissionOutcome(r.revenuePiastres, r.targetPiastres);
    r.progressBp = progressBp(r.revenuePiastres, r.targetPiastres);
    r.neededPiastres = targetGap(r.revenuePiastres, r.targetPiastres);
    r.commissionPiastres = r.outcome === 'hit' ? r.potentialPiastres : 0;
    r.lines.sort((a, b) => b.feesPiastres - a.feesPiastres);
  }
  return out;
}

/** What screens show of a rep's month next to the targets. */
function monthSummary(r: RepMonth) {
  return {
    outcome: r.outcome,
    revenuePiastres: r.revenuePiastres,
    targetPiastres: r.targetPiastres,
    neededPiastres: r.neededPiastres,
    potentialPiastres: r.potentialPiastres,
    commissionPiastres: r.commissionPiastres,
    qualified: r.lines.length,
    pending: r.pending.map((l) => ({
      dealId: l.dealId,
      company: l.company,
      activeMonths: l.activeMonths,
      qualifyMonths: l.qualifyMonths,
    })),
  };
}

// ─── figures ─────────────────────────────────────────────────────────────────────

export interface RepFigures {
  dealsWon: number;
  orders: number;
  /** Counted fees: qualified merchants inside their commission months (as commission counts) */
  feeRevenuePiastres: number;
}

/**
 * Each rep's month: deals won in it, delivered orders of the merchants they won (from the win
 * on) and the counted fees. Only reps with something show; `userId` limits to one.
 */
export async function repFigures(
  db: Db,
  month: string,
  userId: string | null = null,
  now: Date = new Date(),
): Promise<{ figures: Map<string, RepFigures>; months: Map<string, RepMonth> }> {
  const { from, to } = monthRange(month);
  const [won, orders, months] = await Promise.all([
    db.$queryRaw<{ user_id: string; n: bigint }[]>`
      SELECT won_by_id AS user_id, COUNT(*) AS n FROM crm_deals
      WHERE stage = 'won' AND won_by_id IS NOT NULL AND won_at >= ${from} AND won_at < ${to}
        AND (${userId}::text IS NULL OR won_by_id = ${userId})
      GROUP BY won_by_id`,
    db.$queryRaw<{ user_id: string; n: bigint }[]>`
      WITH firsts AS (
        SELECT DISTINCT ON (merchant_id) merchant_id, won_by_id, won_at FROM crm_deals
        WHERE stage = 'won' AND merchant_id IS NOT NULL AND won_by_id IS NOT NULL
        ORDER BY merchant_id, won_at)
      SELECT f.won_by_id AS user_id, COUNT(o.id) AS n FROM firsts f
        JOIN orders o ON o.merchant_id = f.merchant_id
      WHERE o.status = 'delivered' AND o.delivered_at >= GREATEST(${from}::timestamp, f.won_at)
        AND o.delivered_at < ${to} AND (${userId}::text IS NULL OR f.won_by_id = ${userId})
      GROUP BY f.won_by_id`,
    repMonths(db, month, userId, now),
  ]);
  const out = new Map<string, RepFigures>();
  const row = (id: string) => {
    if (!out.has(id)) out.set(id, { dealsWon: 0, orders: 0, feeRevenuePiastres: 0 });
    return out.get(id)!;
  };
  for (const r of won) row(r.user_id).dealsWon = num(r.n);
  for (const r of orders) row(r.user_id).orders = num(r.n);
  for (const [id, m] of months)
    if (m.revenuePiastres) row(id).feeRevenuePiastres = m.revenuePiastres;
  return { figures: out, months };
}

// ─── targets ─────────────────────────────────────────────────────────────────────

/**
 * Targets against what was reached for a month, with the month's commission standing (hit or
 * missed, what it pays, merchants still pending): every sales person for a manager, only
 * themselves for anyone else. Managers also get the reps without a fees target for the current
 * and the next month.
 */
export async function listTargets(db: Db, actor: CrmActor, month: string, now: Date = new Date()) {
  need(actor, 'view');
  monthRange(month);
  const people = (await salesPeople(db)).filter(
    (p) => actor.level === 'manage' || p.id === actor.userId,
  );
  const ids = people.map((p) => p.id);
  const [targets, { figures, months }] = await Promise.all([
    db.crmTarget.findMany({
      where: { month, userId: { in: ids } },
      include: { updatedBy: { select: { name: true } } },
    }),
    repFigures(db, month, actor.level === 'manage' ? null : actor.userId, now),
  ]);
  const byUser = new Map(targets.map((t) => [t.userId, t]));

  let missingTargets: { month: string; users: { id: string; name: string }[] }[] = [];
  if (actor.level === 'manage') {
    const current = cairoDay(now).slice(0, 7);
    const ahead = [current, shiftMonth(current, 1)];
    const set = await db.crmTarget.findMany({
      where: { month: { in: ahead }, feeRevenuePiastres: { gt: 0 } },
      select: { userId: true, month: true },
    });
    const reps = people.filter((p) => !p.manager);
    missingTargets = ahead.map((m) => ({
      month: m,
      users: reps
        .filter((p) => !set.some((s) => s.userId === p.id && s.month === m))
        .map((p) => ({ id: p.id, name: p.name })),
    }));
  }

  return {
    month,
    missingTargets,
    rows: people.map((p) => {
      const t = byUser.get(p.id);
      const f = figures.get(p.id) ?? { dealsWon: 0, orders: 0, feeRevenuePiastres: 0 };
      const m = months.get(p.id) ?? emptyRepMonth(p.id, month, t?.feeRevenuePiastres ?? null);
      return {
        user: { id: p.id, name: p.name, manager: p.manager },
        target: t
          ? {
              dealsWon: t.dealsWon,
              orders: t.orders,
              feeRevenuePiastres: t.feeRevenuePiastres,
              updatedAt: t.updatedAt,
              updatedBy: t.updatedBy.name,
            }
          : null,
        actual: f,
        progress: {
          dealsWon: progressBp(f.dealsWon, t?.dealsWon),
          orders: progressBp(f.orders, t?.orders),
          feeRevenue: progressBp(f.feeRevenuePiastres, t?.feeRevenuePiastres),
        },
        commission: monthSummary(m),
      };
    }),
  };
}

/** A sales manager sets a rep's targets for a month (audited). */
export async function setTarget(db: Db, body: TargetBody, actor: CrmActor) {
  need(actor, 'manage');
  monthRange(body.month);
  return inTransaction(db, async (tx) => {
    const people = await salesPeople(tx);
    if (!people.some((p) => p.id === body.userId)) throw new DomainError('owner_not_sales', 400);
    const before = await tx.crmTarget.findUnique({
      where: { userId_month: { userId: body.userId, month: body.month } },
    });
    const data = {
      dealsWon: body.dealsWon,
      orders: body.orders,
      feeRevenuePiastres: body.feeRevenuePiastres,
      updatedById: actor.userId,
    };
    const row = await tx.crmTarget.upsert({
      where: { userId_month: { userId: body.userId, month: body.month } },
      create: { userId: body.userId, month: body.month, ...data },
      update: data,
    });
    const view = (t: { dealsWon: number; orders: number; feeRevenuePiastres: number }) => ({
      dealsWon: t.dealsWon,
      orders: t.orders,
      feeRevenuePiastres: t.feeRevenuePiastres,
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      action: 'crm_target.set',
      entityType: 'crm_target',
      entityId: `${body.userId}:${body.month}`,
      before: before ? view(before) : undefined,
      after: { userId: body.userId, month: body.month, ...view(row) },
    });
    return row;
  });
}

// ─── dashboard ───────────────────────────────────────────────────────────────────

const PATH = CRM_STAGES.filter((s) => s !== 'lost');
const DAY_MS = 24 * 60 * 60_000;

/**
 * The sales dashboard for a Cairo month: the funnel of the deals opened in it (the furthest
 * stage each reached) with the share going on to the next stage, the open pipeline's monthly fee
 * value by stage (now), win rate and days to close of the deals closed in it, lost reasons, new
 * leads by source, overdue follow ups (now) and the leaderboard against targets. Managers see
 * everyone or one rep; anyone else sees their own numbers.
 */
export async function salesDashboard(
  db: Db,
  actor: CrmActor,
  options: { month: string; ownerId?: string | null },
  now: Date = new Date(),
) {
  need(actor, 'view');
  const { from, to } = monthRange(options.month);
  const who = whoFor(actor, options.ownerId);
  const scope: Prisma.CrmDealWhereInput = {
    AND: [dealScope(actor), who ? { ownerId: who } : {}],
  };

  const opened = await db.crmDeal.findMany({
    where: { AND: [scope, { createdAt: { gte: from, lt: to } }] },
    select: {
      id: true,
      stage: true,
      company: { select: { source: true } },
      history: { select: { toStage: true } },
    },
  });
  const reached: Record<string, number> = {};
  for (const d of opened) {
    const furthest = Math.max(
      0,
      ...[d.stage, ...d.history.map((h) => h.toStage)].map((s) => PATH.indexOf(s as never)),
    );
    for (let i = 0; i <= furthest; i++) reached[PATH[i]!] = (reached[PATH[i]!] ?? 0) + 1;
  }
  const leadsBySource = CRM_SOURCES.map((source) => ({
    source,
    count: opened.filter((d) => d.company.source === source).length,
  })).filter((s) => s.count > 0);

  const open = await db.crmDeal.groupBy({
    by: ['stage'],
    where: { AND: [scope, { stage: { in: [...CRM_OPEN_STAGES] } }] },
    _count: { _all: true },
    _sum: { expectedMonthlyFeePiastres: true },
  });
  const pipeline = CRM_OPEN_STAGES.map((stage) => {
    const g = open.find((o) => o.stage === stage);
    return {
      stage,
      count: g?._count._all ?? 0,
      valuePiastres: g?._sum.expectedMonthlyFeePiastres ?? 0,
    };
  });

  // Who won counts the win (the owner at the moment of the win); losses by the deal's owner.
  const wonWhere: Prisma.CrmDealWhereInput = {
    AND: [
      actor.ownOnly ? { wonById: actor.userId } : {},
      who ? { wonById: who } : {},
      { stage: 'won', wonAt: { gte: from, lt: to } },
    ],
  };
  const won = await db.crmDeal.findMany({
    where: wonWhere,
    select: { createdAt: true, wonAt: true },
  });
  const lost = await db.crmDeal.findMany({
    where: { AND: [scope, { stage: 'lost', lostAt: { gte: from, lt: to } }] },
    select: { lostReason: true },
  });
  const reasons = await db.crmLostReason.findMany();
  const lostReasons = [...new Set(lost.map((l) => l.lostReason ?? 'other'))]
    .map((code) => {
      const r = reasons.find((x) => x.code === code);
      return {
        code,
        label: r ? { en: r.labelEn, ar: r.labelAr } : null,
        count: lost.filter((l) => (l.lostReason ?? 'other') === code).length,
      };
    })
    .sort((a, b) => b.count - a.count);
  const closed = won.length + lost.length;
  const avgDays =
    won.length > 0
      ? Math.round(
          (won.reduce((s, d) => s + (d.wonAt!.getTime() - d.createdAt.getTime()), 0) /
            won.length /
            DAY_MS) *
            10,
        ) / 10
      : null;

  const overdue = await db.crmActivity.count({
    where: {
      AND: [
        activityScope(actor),
        who ? { ownerId: who } : {},
        { doneAt: null, dueAt: { lt: now } },
      ],
    },
  });

  // Deals won in each of the last six months, for the trend.
  const trendFrom = monthStart(shiftMonth(options.month, -5));
  const trendRows = await db.crmDeal.findMany({
    where: {
      AND: [
        actor.ownOnly ? { wonById: actor.userId } : {},
        who ? { wonById: who } : {},
        { stage: 'won', wonAt: { gte: trendFrom, lt: to } },
      ],
    },
    select: { wonAt: true },
  });
  const wonByMonth = [-5, -4, -3, -2, -1, 0].map((n) => {
    const m = shiftMonth(options.month, n);
    return {
      month: m,
      count: trendRows.filter((d) => cairoDay(d.wonAt!).slice(0, 7) === m).length,
    };
  });

  const targets = await listTargets(db, actor, options.month, now);
  const leaderboard = targets.rows
    .filter((r) => !who || r.user.id === who)
    .sort(
      (a, b) =>
        b.actual.feeRevenuePiastres - a.actual.feeRevenuePiastres ||
        b.actual.dealsWon - a.actual.dealsWon ||
        a.user.name.localeCompare(b.user.name),
    );

  return {
    month: options.month,
    ownerId: who,
    funnel: funnel(PATH, reached),
    pipeline,
    pipelineValuePiastres: pipeline.reduce((s, p) => s + p.valuePiastres, 0),
    openDeals: pipeline.reduce((s, p) => s + p.count, 0),
    newLeads: opened.length,
    leadsBySource,
    won: won.length,
    lost: lost.length,
    winRateBp: closed > 0 ? Math.round((won.length * 10_000) / closed) : null,
    avgDaysToClose: avgDays,
    lostReasons,
    overdueFollowUps: overdue,
    wonByMonth,
    leaderboard,
  };
}

// ─── commission ──────────────────────────────────────────────────────────────────

/**
 * Once a Cairo month is over (from its second day after, so the month's minimum fees are in),
 * each rep's commission for it is worked out once (key commission:<rep>:<month>): the counted
 * fees against the fees target, one line per merchant (pending ones included, not counted).
 * A hit with something to pay waits for a sales manager as a draft; a miss, no target or
 * nothing earned is kept closed (0, nothing to approve or pay). Safe to run any number of times.
 */
export async function computeCommissions(db: Db, now: Date = new Date(), month?: string) {
  const today = cairoDay(now);
  const target = month ?? shiftMonth(today.slice(0, 7), -1);
  if (target >= today.slice(0, 7)) throw new DomainError('month_not_over');
  if (!month && Number(today.slice(8, 10)) < 2) return { month: target, created: 0 };
  const reps = await repMonths(db, target, null, now);
  let created = 0;
  for (const [userId, r] of reps) {
    const key = `commission:${userId}:${target}`;
    if (await db.crmCommission.findUnique({ where: { idempotencyKey: key } })) continue;
    const hit = r.outcome === 'hit';
    const total = r.commissionPiastres;
    try {
      await inTransaction(db, async (tx) => {
        const row = await tx.crmCommission.create({
          data: {
            userId,
            month: target,
            status: total > 0 ? 'draft' : 'closed',
            revenuePiastres: r.revenuePiastres,
            targetPiastres: r.targetPiastres,
            outcome: r.outcome,
            computedPiastres: total,
            amountPiastres: total,
            idempotencyKey: key,
            lines: {
              create: [...r.lines, ...r.pending].map((l) => ({
                dealId: l.dealId,
                merchantId: l.merchantId,
                monthIndex: l.monthIndex,
                qualified: l.qualified,
                activeMonths: l.activeMonths,
                qualifiedMonth: l.qualifiedMonth,
                feesPiastres: l.feesPiastres,
                rateBp: l.rateBp,
                amountPiastres: hit ? l.amountPiastres : 0,
              })),
            },
          },
        });
        await recordAudit(tx, {
          actorUserId: null,
          action: 'crm_commission.compute',
          entityType: 'crm_commission',
          entityId: row.id,
          after: {
            userId,
            month: target,
            outcome: r.outcome,
            revenue: r.revenuePiastres,
            target: r.targetPiastres,
            amount: total,
            status: row.status,
            merchants: r.lines.length,
            pending: r.pending.length,
          },
        });
      });
      created++;
    } catch (error) {
      // Another run made it first: nothing to do.
      if ((error as { code?: string }).code !== 'P2002') throw error;
    }
  }
  return { month: target, created };
}

const commissionInclude = {
  user: { select: { id: true, name: true } },
  approvedBy: { select: { name: true } },
  adjustedBy: { select: { name: true } },
  paidEntry: { select: { number: true } },
  lines: {
    include: {
      deal: {
        select: {
          id: true,
          number: true,
          qualifyMonths: true,
          company: { select: { brandName: true } },
        },
      },
    },
    orderBy: [{ qualified: 'desc' }, { feesPiastres: 'desc' }],
  },
} satisfies Prisma.CrmCommissionInclude;

/**
 * Commission: the history (drafts, approved, paid, closed) and the running month's estimate
 * (counted fees so far against the target, what more is needed, what it would pay, pending
 * merchants). A sales manager sees everyone (or one rep); anyone else only their own.
 */
export async function listCommissions(
  db: Db,
  actor: CrmActor,
  options: { userId?: string | null } = {},
  now: Date = new Date(),
) {
  need(actor, 'view');
  const who = whoFor(actor, options.userId);
  const rows = await db.crmCommission.findMany({
    where: who ? { userId: who } : {},
    include: commissionInclude,
    orderBy: [{ month: 'desc' }, { createdAt: 'desc' }],
    take: 300,
  });
  const month = cairoDay(now).slice(0, 7);
  const estimate = await repMonths(db, month, who, now);
  const people = await salesPeople(db);
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? '';
  return {
    month,
    estimate: [...estimate.values()]
      .map((r) => ({ ...r, user: { id: r.userId, name: name(r.userId) } }))
      .sort(
        (a, b) => b.revenuePiastres - a.revenuePiastres || a.user.name.localeCompare(b.user.name),
      ),
    commissions: rows.map((r) => ({
      id: r.id,
      month: r.month,
      status: r.status,
      user: r.user,
      outcome: r.outcome as CommissionOutcome,
      revenuePiastres: r.revenuePiastres,
      targetPiastres: r.targetPiastres,
      computedPiastres: r.computedPiastres,
      amountPiastres: r.amountPiastres,
      adjustReason: r.adjustReason,
      adjustedBy: r.adjustedBy?.name ?? null,
      approvedBy: r.approvedBy?.name ?? null,
      approvedAt: r.approvedAt,
      paidVia: r.paidVia,
      paidAt: r.paidAt,
      paidEntry: r.paidEntry?.number ?? null,
      lines: r.lines.map((l) => ({
        dealId: l.dealId,
        label: dealNumber(l.deal.number),
        company: l.deal.company.brandName,
        monthIndex: l.monthIndex,
        qualified: l.qualified,
        activeMonths: l.activeMonths,
        qualifiedMonth: l.qualifiedMonth,
        qualifyMonths: l.deal.qualifyMonths,
        feesPiastres: l.feesPiastres,
        rateBp: l.rateBp,
        amountPiastres: l.amountPiastres,
      })),
    })),
  };
}

async function draftFor(tx: Tx, id: string, actor: CrmActor) {
  need(actor, 'manage');
  const row = await tx.crmCommission.findUnique({ where: { id } });
  if (!row) throw new DomainError('commission_not_found', 404);
  if (row.userId === actor.userId) throw new DomainError('same_person', 403);
  if (row.status !== 'draft') throw new DomainError('commission_not_draft');
  return row;
}

/** A sales manager changes a draft commission's amount with a reason (never their own). */
export function adjustCommission(
  db: Db,
  id: string,
  body: CommissionAdjustBody,
  actor: CrmActor,
  now: Date = new Date(),
) {
  return inTransaction(db, async (tx) => {
    const before = await draftFor(tx, id, actor);
    const after = await tx.crmCommission.update({
      where: { id },
      data: {
        amountPiastres: body.amountPiastres,
        adjustReason: body.reason,
        adjustedById: actor.userId,
        adjustedAt: now,
      },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      action: 'crm_commission.adjust',
      entityType: 'crm_commission',
      entityId: id,
      before: { amount: before.amountPiastres },
      after: { amount: after.amountPiastres, reason: body.reason },
    });
    return after;
  });
}

/**
 * A sales manager approves a draft commission (never their own: same_person). Approved, it is
 * paid in the salary run of an employee (taxed with the salary) or as a direct bonus to an
 * outsourced person; Accounting never changes the amount.
 */
export function approveCommission(db: Db, id: string, actor: CrmActor, now: Date = new Date()) {
  return inTransaction(db, async (tx) => {
    const before = await draftFor(tx, id, actor);
    const after = await tx.crmCommission.update({
      where: { id },
      data: { status: 'approved', approvedById: actor.userId, approvedAt: now },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      action: 'crm_commission.approve',
      entityType: 'crm_commission',
      entityId: id,
      before: { status: before.status },
      after: { status: 'approved', amount: after.amountPiastres, month: after.month },
    });
    return after;
  });
}

/** Approved commission not paid yet for a person, up to a month (the salary run takes it). */
export function payableCommissions(db: Db, userId: string, month: string) {
  return db.crmCommission.findMany({
    where: { userId, status: 'approved', paidEntryId: null, month: { lte: month } },
    orderBy: { month: 'asc' },
  });
}

/** Marks commissions paid by a salary run or a bonus entry (in that entry's transaction). */
export async function markCommissionsPaid(
  tx: Tx,
  ids: string[],
  via: 'payroll' | 'bonus',
  entryId: string,
  at: Date,
) {
  if (!ids.length) return;
  const done = await tx.crmCommission.updateMany({
    where: { id: { in: ids }, status: 'approved', paidEntryId: null },
    data: { status: 'paid', paidVia: via, paidEntryId: entryId, paidAt: at },
  });
  if (done.count !== ids.length) throw new DomainError('commission_not_payable');
}

/**
 * Approved commission of people hired through an outsourcing company, waiting to be paid as a
 * direct bonus (they are not on our payroll).
 */
export async function outsourcedCommissionsToPay(db: Db) {
  const rows = await db.crmCommission.findMany({
    where: {
      status: 'approved',
      paidEntryId: null,
      user: { employee: { employment: 'outsourced' } },
    },
    include: { user: { select: { id: true, name: true } } },
    orderBy: [{ month: 'asc' }],
  });
  return rows.map((r) => ({
    id: r.id,
    month: r.month,
    user: r.user,
    amountPiastres: r.amountPiastres,
  }));
}

/** The days a month runs, for screens that show "so far" figures. */
export function monthDays(month: string) {
  return { first: `${month}-01`, last: addDays(`${shiftMonth(month, 1)}-01`, -1) };
}
