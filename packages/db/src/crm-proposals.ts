import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  addDays,
  cairoDay,
  contractEndDay,
  dealNumber,
  exampleMonth,
  latinDigits,
  merchantScope,
  normalizeEgyptianPhone,
  PROPOSAL_FEE_KEYS,
  PROPOSAL_FEES,
  proposalApproval,
  type ProposalConfirmBody,
  type ProposalCreateBody,
  type ProposalFees,
  proposalNumber,
  type ProposalUpdateBody,
} from '@shiplynow/shared';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import {
  assertNotLocked,
  assertOwner,
  type CrmActor,
  dealFor,
  dealScope,
  need,
  winTerms,
} from './crm';
import { DomainError } from './domain-error';
import { saveContract } from './finance/contracts';
import { nextNumber } from './finance/ledger';
import { setAccountManager } from './hr';
import { hashPassword } from './password';
import { getSetting, setSetting } from './settings';

type Tx = Prisma.TransactionClient;

// Sales CRM part 2: proposals (docs/SALES.md 8).
//
//   draft ──(discount past sales.max_discount_bp: a sales manager approves)──▶ send
//   sent ──(the brand opens /p/<token>)──▶ viewed ──▶ accepted ──(the rep confirms)──▶ deal won,
//     │                                      │                   merchant, owner login, contract
//     │                                      └──▶ declined
//     └──(sales.proposal_valid_days pass)──▶ expired
//   A new version of a deal's proposal supersedes the open ones (draft, sent, viewed, accepted).
//
// Confirming runs in one transaction: the merchant (approved) from the company, its owner login
// (inactive until they choose a password through a one time link), the merchant contract and
// the fee settings from the proposal's terms, the deal's owner as account manager, company and
// deal linked to the merchant and the deal won. A won deal with a merchant never leaves won.

const PUBLIC_STATUSES_OPEN = ['sent', 'viewed'] as const;
const DAY = (d: Date) => d.toISOString().slice(0, 10);
const dateOf = (day: string) => new Date(`${day}T00:00:00Z`);

/** The fee settings a new proposal starts from (the global values). */
export async function proposalFeeList(db: Db): Promise<ProposalFees> {
  const out = {} as ProposalFees;
  for (const k of PROPOSAL_FEE_KEYS) out[k] = await getSetting(db, PROPOSAL_FEES[k]);
  return out;
}

const proposalInclude = {
  tiers: { orderBy: { fromOrder: 'asc' } },
  createdBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  sentBy: { select: { id: true, name: true } },
  confirmedBy: { select: { id: true, name: true } },
  merchant: { select: { id: true, name: true } },
} satisfies Prisma.CrmProposalInclude;
type ProposalRow = Prisma.CrmProposalGetPayload<{ include: typeof proposalInclude }>;

function tiersOf(p: {
  tiers: { fromOrder: number; fixedFeePiastres: number | null; percentBp: number | null }[];
}) {
  return p.tiers.map((t) => ({
    fromOrder: t.fromOrder,
    fixedFeePiastres: t.fixedFeePiastres,
    percentBp: t.percentBp,
  }));
}

function feesOf(p: ProposalFees): ProposalFees {
  const out = {} as ProposalFees;
  for (const k of PROPOSAL_FEE_KEYS) out[k] = p[k];
  return out;
}

/** What the screens and the audit log show of a proposal. */
function toView(p: ProposalRow) {
  const tiers = tiersOf(p);
  return {
    id: p.id,
    number: p.number,
    label: proposalNumber(p.number),
    dealId: p.dealId,
    version: p.version,
    status: p.status,
    fees: feesOf(p),
    expectedMonthlyOrders: p.expectedMonthlyOrders,
    averageOrderPiastres: p.averageOrderPiastres,
    minimumMonthlyFeePiastres: p.minimumMonthlyFeePiastres,
    securityDepositPiastres: p.securityDepositPiastres,
    creditLimitPiastres: p.creditLimitPiastres,
    contractStartDate: p.contractStartDate ? DAY(p.contractStartDate) : null,
    contractMonths: p.contractMonths,
    noticeDays: p.noticeDays,
    terms: p.terms,
    tiers,
    maxDiscountBp: p.maxDiscountBp,
    needsApproval: p.needsApproval,
    approvalRequestedAt: p.approvalRequestedAt,
    approvedAt: p.approvedAt,
    approvedBy: p.approvedBy,
    token: p.token,
    sentAt: p.sentAt,
    sentBy: p.sentBy,
    validUntil: p.validUntil ? DAY(p.validUntil) : null,
    viewedAt: p.viewedAt,
    acceptedAt: p.acceptedAt,
    declinedAt: p.declinedAt,
    signerName: p.signerName,
    signerTitle: p.signerTitle,
    declineReason: p.declineReason,
    closedAt: p.closedAt,
    confirmedAt: p.confirmedAt,
    confirmedBy: p.confirmedBy,
    merchant: p.merchant,
    createdBy: p.createdBy,
    createdAt: p.createdAt,
    example: exampleMonth({ ...p, tiers }),
  };
}
export type ProposalView = ReturnType<typeof toView>;

function auditView(
  p: {
    number: number;
    version: number;
    status: string;
    maxDiscountBp: number;
  } & ProposalFees,
) {
  return {
    number: proposalNumber(p.number),
    version: p.version,
    status: p.status,
    maxDiscountBp: p.maxDiscountBp,
    ...feesOf(p),
  };
}

async function proposalFor(tx: Db, id: string, actor: CrmActor) {
  const proposal = await tx.crmProposal.findUnique({ where: { id } });
  if (!proposal) throw new DomainError('proposal_not_found', 404);
  const deal = await dealFor(tx, proposal.dealId, actor);
  return { proposal, deal };
}

// ─── reading ─────────────────────────────────────────────────────────────────────

export interface ProposalFilter {
  status?: string;
  /** Drafts waiting for a sales manager's approval */
  needsApproval?: boolean;
  dealId?: string;
}

/** Proposals the actor may see (a rep: their own deals'), newest first. */
export async function listProposals(db: Db, actor: CrmActor, filter: ProposalFilter = {}) {
  need(actor, 'view');
  const rows = await db.crmProposal.findMany({
    where: {
      deal: dealScope(actor),
      ...(filter.dealId && { dealId: filter.dealId }),
      ...(filter.status && { status: filter.status as never }),
      ...(filter.needsApproval && {
        status: 'draft',
        needsApproval: true,
        approvedAt: null,
        approvalRequestedAt: { not: null },
      }),
    },
    include: {
      ...proposalInclude,
      deal: {
        select: {
          id: true,
          number: true,
          stage: true,
          owner: { select: { id: true, name: true } },
          company: { select: { id: true, brandName: true } },
        },
      },
    },
    orderBy: { number: 'desc' },
    take: 500,
  });
  return rows.map((r) => ({
    ...toView(r),
    deal: { ...r.deal, label: dealNumber(r.deal.number) },
  }));
}

/** A deal's proposals, newest version first, plus the fee settings a new one starts from. */
export async function dealProposals(db: Db, dealId: string, actor: CrmActor) {
  need(actor, 'view');
  const deal = await dealFor(db, dealId, actor);
  const rows = await db.crmProposal.findMany({
    where: { dealId },
    include: proposalInclude,
    orderBy: { version: 'desc' },
  });
  const merchantOwner = deal.merchantId
    ? await db.user.findFirst({
        where: { merchantId: deal.merchantId, role: 'merchant', merchantRole: 'owner' },
        select: { id: true, name: true, email: true, isActive: true },
        orderBy: { createdAt: 'asc' },
      })
    : null;
  return {
    proposals: rows.map(toView),
    defaults: await proposalFeeList(db),
    maxDiscountBp: await getSetting(db, 'sales.max_discount_bp'),
    validDays: await getSetting(db, 'sales.proposal_valid_days'),
    merchantOwner,
  };
}

// ─── creating and editing ────────────────────────────────────────────────────────

/** The proposal's values after a change, with its discount check worked out again. */
async function priced(
  tx: Db,
  values: ProposalFees & {
    tiers: { fromOrder: number; fixedFeePiastres: number | null; percentBp: number | null }[];
  },
) {
  const list = await proposalFeeList(tx);
  const max = await getSetting(tx, 'sales.max_discount_bp');
  return proposalApproval(values, list, max);
}

/**
 * A new proposal (version n + 1) for a deal: values left out start from the fee settings and the
 * deal's expected orders. The deal's open proposals are superseded by it.
 */
export async function createProposal(
  db: Db,
  body: ProposalCreateBody,
  actor: CrmActor,
  now: Date = new Date(),
) {
  need(actor, 'use');
  const seen = await db.crmProposal.findUnique({
    where: { idempotencyKey: body.idempotencyKey },
    include: proposalInclude,
  });
  if (seen) return toView(seen);
  return inTransaction(db, async (tx) => {
    const deal = await dealFor(tx, body.dealId, actor);
    if (deal.stage === 'won' || deal.stage === 'lost') throw new DomainError('deal_closed');
    await tx.$queryRaw`SELECT id FROM crm_deals WHERE id = ${deal.id} FOR UPDATE`;
    const list = await proposalFeeList(tx);
    const fees = {} as ProposalFees;
    for (const k of PROPOSAL_FEE_KEYS) fees[k] = body[k] ?? list[k];
    const tiers = [...(body.tiers ?? [])].sort((a, b) => a.fromOrder - b.fromOrder);
    const approval = await priced(tx, { ...fees, tiers });
    const last = await tx.crmProposal.aggregate({
      where: { dealId: deal.id },
      _max: { version: true },
    });
    const superseded = await tx.crmProposal.findMany({
      where: { dealId: deal.id, status: { in: ['draft', 'sent', 'viewed', 'accepted'] } },
      select: { id: true, number: true },
    });
    if (superseded.length)
      await tx.crmProposal.updateMany({
        where: { id: { in: superseded.map((s) => s.id) } },
        data: { status: 'superseded', closedAt: now },
      });
    const proposal = await tx.crmProposal.create({
      data: {
        number: await nextNumber(tx, 'crm_proposals'),
        dealId: deal.id,
        version: (last._max.version ?? 0) + 1,
        ...fees,
        expectedMonthlyOrders: body.expectedMonthlyOrders ?? deal.expectedMonthlyOrders ?? null,
        averageOrderPiastres: body.averageOrderPiastres ?? null,
        minimumMonthlyFeePiastres: body.minimumMonthlyFeePiastres ?? null,
        securityDepositPiastres: body.securityDepositPiastres ?? null,
        creditLimitPiastres: body.creditLimitPiastres ?? null,
        contractStartDate: body.contractStartDate ? dateOf(body.contractStartDate) : null,
        contractMonths: body.contractMonths ?? null,
        noticeDays: body.noticeDays ?? 30,
        terms: body.terms ?? null,
        maxDiscountBp: approval.maxDiscountBp,
        needsApproval: approval.needsApproval,
        createdById: actor.userId,
        idempotencyKey: body.idempotencyKey,
        createdAt: now,
        tiers: { create: tiers },
      },
      include: proposalInclude,
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      action: 'crm_proposal.create',
      entityType: 'crm_deal',
      entityId: deal.id,
      after: {
        ...auditView(proposal),
        superseded: superseded.map((s) => proposalNumber(s.number)),
      },
    });
    return toView(proposal);
  });
}

/** Edits a draft. A change of price clears an earlier approval and checks the discount again. */
export async function updateProposal(
  db: Db,
  id: string,
  body: ProposalUpdateBody,
  actor: CrmActor,
) {
  need(actor, 'use');
  return inTransaction(db, async (tx) => {
    const { proposal: before } = await proposalFor(tx, id, actor);
    if (before.status !== 'draft') throw new DomainError('proposal_not_draft');
    const beforeTiers = await tx.crmProposalTier.findMany({
      where: { proposalId: id },
      orderBy: { fromOrder: 'asc' },
    });
    const fees = {} as ProposalFees;
    for (const k of PROPOSAL_FEE_KEYS) fees[k] = body[k] ?? before[k];
    const tiers = body.tiers
      ? [...body.tiers].sort((a, b) => a.fromOrder - b.fromOrder)
      : tiersOf({ tiers: beforeTiers });
    const approval = await priced(tx, { ...fees, tiers });
    const priceChanged =
      PROPOSAL_FEE_KEYS.some((k) => fees[k] !== before[k]) ||
      JSON.stringify(tiers) !== JSON.stringify(tiersOf({ tiers: beforeTiers })) ||
      (body.minimumMonthlyFeePiastres !== undefined &&
        body.minimumMonthlyFeePiastres !== before.minimumMonthlyFeePiastres);
    if (body.tiers) {
      await tx.crmProposalTier.deleteMany({ where: { proposalId: id } });
      if (tiers.length)
        await tx.crmProposalTier.createMany({ data: tiers.map((t) => ({ proposalId: id, ...t })) });
    }
    const after = await tx.crmProposal.update({
      where: { id },
      data: {
        ...fees,
        expectedMonthlyOrders: body.expectedMonthlyOrders,
        averageOrderPiastres: body.averageOrderPiastres,
        minimumMonthlyFeePiastres: body.minimumMonthlyFeePiastres,
        securityDepositPiastres: body.securityDepositPiastres,
        creditLimitPiastres: body.creditLimitPiastres,
        contractStartDate:
          body.contractStartDate === undefined
            ? undefined
            : body.contractStartDate
              ? dateOf(body.contractStartDate)
              : null,
        contractMonths: body.contractMonths,
        noticeDays: body.noticeDays,
        terms: body.terms,
        maxDiscountBp: approval.maxDiscountBp,
        needsApproval: approval.needsApproval,
        // A new price is a new question for the manager.
        ...(priceChanged && { approvedAt: null, approvedById: null, approvalRequestedAt: null }),
      },
      include: proposalInclude,
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      action: 'crm_proposal.update',
      entityType: 'crm_deal',
      entityId: before.dealId,
      before: auditView(before),
      after: auditView(after),
    });
    return toView(after);
  });
}

/** The rep asks a sales manager to approve a discount past the limit (they are told by push). */
export async function requestProposalApproval(
  db: Db,
  id: string,
  actor: CrmActor,
  now: Date = new Date(),
) {
  need(actor, 'use');
  return inTransaction(db, async (tx) => {
    const { proposal } = await proposalFor(tx, id, actor);
    if (proposal.status !== 'draft') throw new DomainError('proposal_not_draft');
    if (!proposal.needsApproval) throw new DomainError('approval_not_needed');
    if (proposal.approvedAt) return proposal;
    const after = await tx.crmProposal.update({
      where: { id },
      data: { approvalRequestedAt: now },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      action: 'crm_proposal.approval_request',
      entityType: 'crm_deal',
      entityId: proposal.dealId,
      after: { number: proposalNumber(proposal.number), maxDiscountBp: proposal.maxDiscountBp },
    });
    return after;
  });
}

/**
 * A sales manager approves a proposal's discount. Never the person who made the proposal
 * (same_person), like every second person rule.
 */
export async function approveProposal(db: Db, id: string, actor: CrmActor, now: Date = new Date()) {
  need(actor, 'manage');
  return inTransaction(db, async (tx) => {
    const { proposal } = await proposalFor(tx, id, actor);
    if (proposal.status !== 'draft') throw new DomainError('proposal_not_draft');
    if (!proposal.needsApproval) throw new DomainError('approval_not_needed');
    if (proposal.createdById === actor.userId) throw new DomainError('same_person', 403);
    const after = await tx.crmProposal.update({
      where: { id },
      data: { approvedAt: now, approvedById: actor.userId },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      action: 'crm_proposal.approve',
      entityType: 'crm_deal',
      entityId: proposal.dealId,
      after: { number: proposalNumber(proposal.number), maxDiscountBp: proposal.maxDiscountBp },
    });
    return after;
  });
}

/**
 * Sends a draft: makes its public link, sets the day it expires (sales.proposal_valid_days)
 * and moves the deal to the proposal stage when it was earlier in the pipeline.
 */
export async function sendProposal(db: Db, id: string, actor: CrmActor, now: Date = new Date()) {
  need(actor, 'use');
  return inTransaction(db, async (tx) => {
    const { proposal, deal } = await proposalFor(tx, id, actor);
    if (proposal.status !== 'draft') throw new DomainError('proposal_not_draft');
    if (deal.stage === 'won' || deal.stage === 'lost') throw new DomainError('deal_closed');
    if (proposal.needsApproval && !proposal.approvedAt) throw new DomainError('approval_required');
    const validDays = await getSetting(tx, 'sales.proposal_valid_days');
    const after = await tx.crmProposal.update({
      where: { id },
      data: {
        status: 'sent',
        token: randomBytes(24).toString('base64url'),
        sentAt: now,
        sentById: actor.userId,
        validUntil: dateOf(addDays(cairoDay(now), validDays)),
      },
      include: proposalInclude,
    });
    if (['new', 'contacted', 'meeting'].includes(deal.stage)) {
      await tx.crmDeal.update({
        where: { id: deal.id },
        data: { stage: 'proposal', stageChangedAt: now },
      });
      await tx.crmDealStageHistory.create({
        data: {
          dealId: deal.id,
          fromStage: deal.stage,
          toStage: 'proposal',
          changedById: actor.userId,
          changedAt: now,
          note: proposalNumber(proposal.number),
        },
      });
      await tx.alert.updateMany({
        where: {
          type: 'crm_deal_stale',
          resolvedAt: null,
          key: { startsWith: `crm_deal_stale:${deal.id}:` },
        },
        data: { resolvedAt: now, resolvedById: actor.userId },
      });
      await recordAudit(tx, {
        actorUserId: actor.userId,
        action: 'crm_deal.stage',
        entityType: 'crm_deal',
        entityId: deal.id,
        before: { stage: deal.stage },
        after: { stage: 'proposal', proposal: proposalNumber(proposal.number) },
      });
    }
    await recordAudit(tx, {
      actorUserId: actor.userId,
      action: 'crm_proposal.send',
      entityType: 'crm_deal',
      entityId: deal.id,
      after: {
        number: proposalNumber(proposal.number),
        validUntil: after.validUntil ? DAY(after.validUntil) : null,
      },
    });
    return toView(after);
  });
}

// ─── the brand's side (public link) ─────────────────────────────────────────────

/** Whether a sent proposal's last day (Cairo) is over. */
function isExpired(p: { validUntil: Date | null }, now: Date) {
  return !!p.validUntil && DAY(p.validUntil) < cairoDay(now);
}

async function byToken(tx: Db, token: string) {
  if (!token || token.length > 100) throw new DomainError('proposal_not_found', 404);
  const proposal = await tx.crmProposal.findUnique({ where: { token } });
  if (!proposal || proposal.status === 'draft') throw new DomainError('proposal_not_found', 404);
  return proposal;
}

/** Marks open proposals whose last day passed as expired (the reminder job; also lazily). */
export async function expireProposals(db: Db, now: Date = new Date()) {
  const result = await db.crmProposal.updateMany({
    where: {
      status: { in: [...PUBLIC_STATUSES_OPEN] },
      validUntil: { lt: dateOf(cairoDay(now)) },
    },
    data: { status: 'expired', closedAt: now },
  });
  return { expired: result.count };
}

/**
 * The public proposal page: our company, the brand, the rates in plain numbers, the example
 * month and the terms. Opening it marks a sent proposal viewed (once); a proposal past its last
 * day is expired first.
 */
export async function publicProposal(db: Db, token: string, now: Date = new Date()) {
  return inTransaction(db, async (tx) => {
    let proposal = await byToken(tx, token);
    if ((proposal.status === 'sent' || proposal.status === 'viewed') && isExpired(proposal, now))
      proposal = await tx.crmProposal.update({
        where: { id: proposal.id },
        data: { status: 'expired', closedAt: now },
      });
    if (proposal.status === 'sent')
      proposal = await tx.crmProposal.update({
        where: { id: proposal.id },
        data: { status: 'viewed', viewedAt: now },
      });
    const full = await tx.crmProposal.findUniqueOrThrow({
      where: { id: proposal.id },
      include: {
        tiers: { orderBy: { fromOrder: 'asc' } },
        deal: {
          select: {
            company: { select: { brandName: true } },
            owner: { select: { name: true, email: true, phone: true } },
          },
        },
      },
    });
    const company = await tx.companyProfile.findUnique({ where: { id: 'company' } });
    const tiers = tiersOf(full);
    return {
      label: proposalNumber(full.number),
      version: full.version,
      status: full.status,
      brand: full.deal.company.brandName,
      company: {
        legalNameEn: company?.legalNameEn || 'Shiply Now',
        legalNameAr: company?.legalNameAr || 'شيبلي ناو',
        taxRegistrationNumber: company?.taxRegistrationNumber || null,
        address: [
          company?.buildingNumber,
          company?.street,
          company?.regionCity,
          company?.governorate,
        ]
          .filter((v) => v)
          .join(', '),
      },
      rep: full.deal.owner
        ? { name: full.deal.owner.name, email: full.deal.owner.email, phone: full.deal.owner.phone }
        : null,
      fees: feesOf(full),
      tiers,
      expectedMonthlyOrders: full.expectedMonthlyOrders,
      averageOrderPiastres: full.averageOrderPiastres,
      minimumMonthlyFeePiastres: full.minimumMonthlyFeePiastres,
      securityDepositPiastres: full.securityDepositPiastres,
      creditLimitPiastres: full.creditLimitPiastres,
      contractStartDate: full.contractStartDate ? DAY(full.contractStartDate) : null,
      contractMonths: full.contractMonths,
      noticeDays: full.noticeDays,
      terms: full.terms,
      vatBp: await getSetting(tx, 'fee.vat_bp'),
      sentAt: full.sentAt,
      validUntil: full.validUntil ? DAY(full.validUntil) : null,
      acceptedAt: full.acceptedAt,
      declinedAt: full.declinedAt,
      signerName: full.signerName,
      signerTitle: full.signerTitle,
      example: exampleMonth({ ...full, tiers }),
    };
  });
}
export type PublicProposal = Awaited<ReturnType<typeof publicProposal>>;

/** Refuses an answer on a proposal that is no longer open. */
function assertOpen(p: { status: string; validUntil: Date | null }, now: Date) {
  if (
    p.status === 'expired' ||
    ((p.status === 'sent' || p.status === 'viewed') && isExpired(p, now))
  )
    throw new DomainError('proposal_expired', 409);
  if (p.status !== 'sent' && p.status !== 'viewed') throw new DomainError('proposal_closed', 409);
}

/**
 * The brand accepts online with the signer's name and title. Accepting twice changes nothing.
 * The deal's owner is told and confirms it.
 */
export async function acceptProposal(
  db: Db,
  token: string,
  body: { signerName: string; signerTitle: string },
  now: Date = new Date(),
) {
  return inTransaction(db, async (tx) => {
    const proposal = await byToken(tx, token);
    if (proposal.status === 'accepted') return { status: 'accepted' as const };
    assertOpen(proposal, now);
    await tx.$queryRaw`SELECT id FROM crm_proposals WHERE id = ${proposal.id} FOR UPDATE`;
    const claimed = await tx.crmProposal.updateMany({
      where: { id: proposal.id, status: { in: [...PUBLIC_STATUSES_OPEN] } },
      data: {
        status: 'accepted',
        acceptedAt: now,
        viewedAt: proposal.viewedAt ?? now,
        signerName: body.signerName,
        signerTitle: body.signerTitle,
      },
    });
    if (claimed.count === 0) throw new DomainError('proposal_closed', 409);
    await recordAudit(tx, {
      actorUserId: null,
      action: 'crm_proposal.accept',
      entityType: 'crm_deal',
      entityId: proposal.dealId,
      after: {
        number: proposalNumber(proposal.number),
        signerName: body.signerName,
        signerTitle: body.signerTitle,
      },
    });
    return { status: 'accepted' as const };
  });
}

export async function declineProposal(
  db: Db,
  token: string,
  body: { signerName: string; reason?: string | null },
  now: Date = new Date(),
) {
  return inTransaction(db, async (tx) => {
    const proposal = await byToken(tx, token);
    if (proposal.status === 'declined') return { status: 'declined' as const };
    assertOpen(proposal, now);
    const claimed = await tx.crmProposal.updateMany({
      where: { id: proposal.id, status: { in: [...PUBLIC_STATUSES_OPEN] } },
      data: {
        status: 'declined',
        declinedAt: now,
        viewedAt: proposal.viewedAt ?? now,
        signerName: body.signerName,
        declineReason: body.reason ?? null,
      },
    });
    if (claimed.count === 0) throw new DomainError('proposal_closed', 409);
    await recordAudit(tx, {
      actorUserId: null,
      action: 'crm_proposal.decline',
      entityType: 'crm_deal',
      entityId: proposal.dealId,
      after: {
        number: proposalNumber(proposal.number),
        signerName: body.signerName,
        reason: body.reason ?? null,
      },
    });
    return { status: 'declined' as const };
  });
}

// ─── confirming: the merchant is opened ─────────────────────────────────────────

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * A one time link for a new owner to choose their password (sales.setup_link_days). Earlier
 * unused links of the person stop working. Returns the token, shown once.
 */
export async function issueSetupToken(
  tx: Tx,
  userId: string,
  actorUserId: string | null,
  now: Date = new Date(),
) {
  const days = await getSetting(tx, 'sales.setup_link_days');
  await tx.userSetupToken.updateMany({
    where: { userId, usedAt: null },
    data: { expiresAt: now },
  });
  const token = randomBytes(24).toString('base64url');
  await tx.userSetupToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + days * 24 * 60 * 60_000),
      createdById: actorUserId,
      createdAt: now,
    },
  });
  return token;
}

/**
 * The rep confirms an accepted proposal. In one transaction: the merchant (approved) from the
 * company, unless the company is a merchant already (a sign up), its owner login (inactive
 * until they choose a password), the contract and the merchant's fee settings from the
 * proposal, the deal's owner as account manager, company and deal linked, the deal won.
 * Confirming again changes nothing. The setup link comes back once, at the first confirm.
 */
export async function confirmProposal(
  db: Db,
  id: string,
  body: ProposalConfirmBody,
  actor: CrmActor,
  now: Date = new Date(),
) {
  need(actor, 'use');
  // The password hash is slow: made before the transaction, only used when an owner is created.
  const placeholder = await hashPassword(randomBytes(24).toString('base64url'));
  try {
    return await inTransaction(db, async (tx) => {
      const { proposal } = await proposalFor(tx, id, actor);
      await tx.$queryRaw`SELECT id FROM crm_deals WHERE id = ${proposal.dealId} FOR UPDATE`;
      const fresh = await tx.crmProposal.findUniqueOrThrow({
        where: { id },
        include: { tiers: { orderBy: { fromOrder: 'asc' } } },
      });
      const deal = await tx.crmDeal.findUniqueOrThrow({
        where: { id: fresh.dealId },
        include: { company: { include: { contacts: { orderBy: { createdAt: 'asc' } } } } },
      });
      if (fresh.confirmedAt)
        return { merchantId: fresh.merchantId!, ownerUserId: null, setupToken: null, again: true };
      if (fresh.status !== 'accepted') throw new DomainError('proposal_not_accepted');
      assertNotLocked(deal);
      if (deal.stage === 'lost') throw new DomainError('deal_closed');

      // The merchant: the company's own (a sign up) or a new one.
      let merchantId = deal.merchantId ?? deal.company.merchantId;
      let ownerUserId: string | null = null;
      let setupToken: string | null = null;
      const contact = deal.company.contacts[0];
      if (!merchantId) {
        const email = body.ownerEmail ?? contact?.email ?? null;
        const name = body.ownerName ?? fresh.signerName ?? contact?.name ?? null;
        if (!email) throw new DomainError('owner_email_required', 400);
        if (!name) throw new DomainError('owner_name_required', 400);
        // A mobile typed by the rep must be valid; the contact's is used only when it is.
        if (body.ownerPhone && !normalizeEgyptianPhone(latinDigits(body.ownerPhone)))
          throw new DomainError('invalid_phone', 400);
        const phoneText =
          body.ownerPhone === undefined ? (contact?.phone ?? null) : body.ownerPhone;
        const phone = phoneText ? normalizeEgyptianPhone(latinDigits(phoneText)) : null;
        const merchant = await tx.merchant.create({
          data: {
            name: body.merchantName ?? deal.company.brandName,
            contactEmail: email,
            contactPhone: phone,
            isActive: true,
            approval: 'approved',
            accountManagerId: deal.ownerId,
          },
        });
        merchantId = merchant.id;
        const owner = await tx.user.create({
          data: {
            email,
            name,
            phone: phone && !(await tx.user.findUnique({ where: { phone } })) ? phone : null,
            role: 'merchant',
            passwordHash: placeholder,
            isActive: false,
            merchantId: merchant.id,
            merchantRole: 'owner',
          },
        });
        ownerUserId = owner.id;
        setupToken = await issueSetupToken(tx, owner.id, actor.userId, now);
        await recordAudit(tx, {
          actorUserId: actor.userId,
          action: 'merchant.create',
          entityType: 'merchant',
          entityId: merchant.id,
          after: {
            name: merchant.name,
            contactEmail: merchant.contactEmail,
            contactPhone: merchant.contactPhone,
            fromProposal: proposalNumber(fresh.number),
            accountManagerId: deal.ownerId,
          },
        });
        await recordAudit(tx, {
          actorUserId: actor.userId,
          action: 'user.create',
          entityType: 'user',
          entityId: owner.id,
          after: {
            email: owner.email,
            name: owner.name,
            role: 'merchant',
            merchantRole: 'owner',
            isActive: false,
            setupLink: true,
          },
        });
      } else {
        const before = await tx.merchant.findUniqueOrThrow({ where: { id: merchantId } });
        await tx.merchant.update({
          where: { id: merchantId },
          data: {
            accountManagerId: deal.ownerId ?? before.accountManagerId,
            ...(before.approval !== 'approved' && { approval: 'approved', isActive: true }),
          },
        });
        if (before.approval !== 'approved')
          await tx.user.updateMany({
            where: { merchantId, role: 'merchant' },
            data: { isActive: true },
          });
        await recordAudit(tx, {
          actorUserId: actor.userId,
          action: 'merchant.update',
          entityType: 'merchant',
          entityId: merchantId,
          before: { accountManagerId: before.accountManagerId, approval: before.approval },
          after: {
            accountManagerId: deal.ownerId ?? before.accountManagerId,
            approval: 'approved',
            fromProposal: proposalNumber(fresh.number),
          },
        });
      }

      // The contract and the merchant's own fee values.
      const start = fresh.contractStartDate ? DAY(fresh.contractStartDate) : cairoDay(now);
      await saveContract(tx, {
        merchantId,
        actorUserId: actor.userId,
        startDate: start,
        endDate: contractEndDay(start, fresh.contractMonths),
        noticeDays: fresh.noticeDays,
        minimumMonthlyFeePiastres: fresh.minimumMonthlyFeePiastres,
        securityDepositPiastres: fresh.securityDepositPiastres,
        creditLimitPiastres: fresh.creditLimitPiastres,
        note: `${proposalNumber(fresh.number)} · ${dealNumber(deal.number)}`,
        tiers: tiersOf(fresh),
      });
      for (const k of PROPOSAL_FEE_KEYS)
        await setSetting(tx, {
          key: PROPOSAL_FEES[k],
          value: fresh[k],
          scope: merchantScope(merchantId),
          actorUserId: actor.userId,
        });

      // Company and deal linked, the deal won.
      if (deal.company.merchantId !== merchantId)
        await tx.crmCompany.update({ where: { id: deal.companyId }, data: { merchantId } });
      const terms = deal.stage === 'won' ? {} : await winTerms(tx, deal.ownerId);
      await tx.crmDeal.update({
        where: { id: deal.id },
        data: {
          merchantId,
          ...(deal.stage !== 'won' && { stage: 'won', stageChangedAt: now, wonAt: now, ...terms }),
        },
      });
      if (deal.stage !== 'won') {
        await tx.crmDealStageHistory.create({
          data: {
            dealId: deal.id,
            fromStage: deal.stage,
            toStage: 'won',
            changedById: actor.userId,
            changedAt: now,
            note: proposalNumber(fresh.number),
          },
        });
        await tx.alert.updateMany({
          where: {
            type: 'crm_deal_stale',
            resolvedAt: null,
            key: { startsWith: `crm_deal_stale:${deal.id}:` },
          },
          data: { resolvedAt: now, resolvedById: actor.userId },
        });
      }
      await tx.crmProposal.update({
        where: { id },
        data: { confirmedAt: now, confirmedById: actor.userId, merchantId },
      });
      await recordAudit(tx, {
        actorUserId: actor.userId,
        action: 'crm_deal.won',
        entityType: 'crm_deal',
        entityId: deal.id,
        before: { stage: deal.stage, merchantId: deal.merchantId },
        after: {
          stage: 'won',
          merchantId,
          proposal: proposalNumber(fresh.number),
          wonById: deal.stage === 'won' ? deal.wonById : deal.ownerId,
        },
      });
      return { merchantId, ownerUserId, setupToken, again: false };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = String(error.meta?.target ?? '');
      if (target.includes('email')) throw new DomainError('email_taken', 409);
    }
    throw error;
  }
}

/**
 * A new setup link for the owner of a won deal's merchant who has not chosen a password yet
 * (the first was lost or ran out).
 */
export async function newOwnerSetupLink(
  db: Db,
  dealId: string,
  actor: CrmActor,
  now: Date = new Date(),
) {
  need(actor, 'use');
  return inTransaction(db, async (tx) => {
    const deal = await dealFor(tx, dealId, actor);
    if (!deal.merchantId || deal.stage !== 'won') throw new DomainError('deal_not_won');
    const owner = await tx.user.findFirst({
      where: { merchantId: deal.merchantId, role: 'merchant', merchantRole: 'owner' },
      orderBy: { createdAt: 'asc' },
    });
    if (!owner) throw new DomainError('owner_not_found', 404);
    if (owner.isActive) throw new DomainError('owner_already_active');
    const token = await issueSetupToken(tx, owner.id, actor.userId, now);
    await recordAudit(tx, {
      actorUserId: actor.userId,
      action: 'user.setup_link',
      entityType: 'user',
      entityId: owner.id,
      after: { dealId },
    });
    return { setupToken: token };
  });
}

/** The page behind a setup link: whose account it opens (valid, unused, not run out). */
export async function readSetupToken(db: Db, token: string, now: Date = new Date()) {
  if (!token || token.length > 100) throw new DomainError('setup_link_invalid', 404);
  const row = await db.userSetupToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: { select: { name: true, email: true, merchant: { select: { name: true } } } },
    },
  });
  if (!row || row.usedAt || row.expiresAt <= now) throw new DomainError('setup_link_invalid', 404);
  return { name: row.user.name, email: row.user.email, merchant: row.user.merchant?.name ?? null };
}

/** The owner chooses a password: the account opens and the link is used up. */
export async function useSetupToken(
  db: Db,
  token: string,
  password: string,
  now: Date = new Date(),
) {
  const passwordHash = await hashPassword(password);
  return inTransaction(db, async (tx) => {
    const row = await tx.userSetupToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.usedAt || row.expiresAt <= now)
      throw new DomainError('setup_link_invalid', 404);
    const claimed = await tx.userSetupToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count === 0) throw new DomainError('setup_link_invalid', 404);
    const user = await tx.user.update({
      where: { id: row.userId },
      data: { passwordHash, isActive: true },
    });
    await tx.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now },
    });
    await recordAudit(tx, {
      actorUserId: user.id,
      action: 'user.setup_password',
      entityType: 'user',
      entityId: user.id,
      after: { isActive: true },
    });
    return { email: user.email };
  });
}

/**
 * A sales manager changes who looks after a won merchant (the deal's owner by default). Only
 * sales people can be picked here.
 */
export async function setDealAccountManager(
  db: Db,
  dealId: string,
  userId: string | null,
  actor: CrmActor,
) {
  need(actor, 'manage');
  return inTransaction(db, async (tx) => {
    const deal = await dealFor(tx, dealId, actor);
    if (!deal.merchantId) throw new DomainError('deal_not_won');
    if (userId) await assertOwner(tx, userId);
    return setAccountManager(tx, {
      merchantId: deal.merchantId,
      userId,
      actorUserId: actor.userId,
    });
  });
}
