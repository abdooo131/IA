import { Prisma } from '@prisma/client';
import {
  type AccessLevel,
  type AccessProfile,
  addDays,
  cairoDay,
  cairoDayStart,
  type CrmActivityBody,
  type CrmActivityUpdateBody,
  type CrmCompanyBody,
  type CrmCompanyUpdateBody,
  type CrmContactBody,
  type CrmContactUpdateBody,
  type CrmDealCreateBody,
  type CrmDealUpdateBody,
  type CrmLostReasonBody,
  type CrmLostReasonUpdateBody,
  type CrmSource,
  type CrmStage,
  type CrmStageBody,
  CRM_OPEN_STAGES,
  dealNumber,
  DEFAULT_LOST_REASONS,
  isOpenStage,
  latinDigits,
  LOST_REASON_OTHER,
  normalizeEgyptianPhone,
  ORDERS_BAND_ESTIMATE,
  type OrdersBand,
  TEAM_ROLES,
} from '@shiplynow/shared';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';
import { nextNumber } from './finance/ledger';
import { getSetting } from './settings';

// Sales CRM part 1 (docs/SALES.md).
//
//   website form ─┐
//   sign up ──────┼──▶ company + contact + deal (stage new) ──▶ managers' queue, or the next rep
//   rep by hand ──┘                                              when sales.auto_assign is 1
//
//   new ─▶ contacted ─▶ meeting ─▶ proposal ─▶ negotiation ─▶ won
//    └──────────┴──────────┴───────────┴────────────┴───────▶ lost (a reason from the list)
//
// Every stage a deal enters is kept in crm_deal_stage_history (append only). Every open deal
// should have a next step: an open activity with a due date. People with sales view read, use
// creates and edits, manage reassigns and sees everything; with own_deals_only (sales reps) only
// their own companies, deals and activities, and any other answers deal_not_allowed.

type Tx = Prisma.TransactionClient;

/** Who acts in the CRM and how far they reach. */
export interface CrmActor {
  userId: string;
  level: AccessLevel;
  /** Only their own records (own_deals_only; never for managers) */
  ownOnly: boolean;
}

export function crmActor(
  profile: Pick<AccessProfile, 'sales' | 'ownDealsOnly'>,
  userId: string,
): CrmActor {
  return {
    userId,
    level: profile.sales,
    ownOnly: profile.ownDealsOnly && profile.sales !== 'manage',
  };
}

const RANK: Record<AccessLevel, number> = { none: 0, view: 1, use: 2, manage: 3 };
function need(actor: CrmActor, level: Exclude<AccessLevel, 'none'>) {
  if (RANK[actor.level] < RANK[level]) throw new DomainError('no_access', 403);
}
const notAllowed = () => new DomainError('deal_not_allowed', 403);

// ─── scope ──────────────────────────────────────────────────────────────────────

function dealScope(actor: CrmActor): Prisma.CrmDealWhereInput {
  return actor.ownOnly ? { ownerId: actor.userId } : {};
}
function companyScope(actor: CrmActor): Prisma.CrmCompanyWhereInput {
  return actor.ownOnly
    ? { OR: [{ ownerId: actor.userId }, { deals: { some: { ownerId: actor.userId } } }] }
    : {};
}
function activityScope(actor: CrmActor): Prisma.CrmActivityWhereInput {
  return actor.ownOnly
    ? { OR: [{ ownerId: actor.userId }, { deal: { ownerId: actor.userId } }] }
    : {};
}

async function dealFor(tx: Db, id: string, actor: CrmActor) {
  const deal = await tx.crmDeal.findUnique({ where: { id }, include: { company: true } });
  if (!deal) throw new DomainError('deal_not_found', 404);
  if (actor.ownOnly && deal.ownerId !== actor.userId) throw notAllowed();
  return deal;
}

async function companyFor(tx: Db, id: string, actor: CrmActor) {
  const company = await tx.crmCompany.findUnique({ where: { id } });
  if (!company) throw new DomainError('company_not_found', 404);
  if (actor.ownOnly && company.ownerId !== actor.userId) {
    const mine = await tx.crmDeal.count({ where: { companyId: id, ownerId: actor.userId } });
    if (mine === 0) throw notAllowed();
  }
  return company;
}

async function activityFor(tx: Db, id: string, actor: CrmActor) {
  const activity = await tx.crmActivity.findUnique({
    where: { id },
    include: { deal: { select: { ownerId: true } } },
  });
  if (!activity) throw new DomainError('activity_not_found', 404);
  if (actor.ownOnly && activity.ownerId !== actor.userId && activity.deal?.ownerId !== actor.userId)
    throw notAllowed();
  return activity;
}

// ─── people ─────────────────────────────────────────────────────────────────────

/** Active team members who may own CRM records (sales use or manage). */
export async function salesPeople(db: Db) {
  const rows = await db.user.findMany({
    where: {
      isActive: true,
      role: { in: [...TEAM_ROLES] },
      access: { sales: { in: ['use', 'manage'] } },
    },
    select: { id: true, name: true, access: { select: { sales: true, ownDealsOnly: true } } },
    orderBy: { name: 'asc' },
  });
  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    manager: u.access?.sales === 'manage',
  }));
}

async function assertOwner(tx: Tx, ownerId: string) {
  const people = await salesPeople(tx);
  if (!people.some((p) => p.id === ownerId)) throw new DomainError('owner_not_sales', 400);
}

/**
 * The owner a record gets: a rep may only name themselves; a manager may name any sales person
 * or nobody (the queue). `fallback` is used when nothing is named.
 */
async function ownerFor(
  tx: Tx,
  actor: CrmActor,
  asked: string | null | undefined,
  fallback: string | null,
): Promise<string | null> {
  if (asked === undefined) return fallback;
  if (asked === actor.userId) return asked;
  if (actor.level !== 'manage') throw new DomainError('owner_not_allowed', 403);
  if (asked !== null) await assertOwner(tx, asked);
  return asked;
}

/**
 * With sales.auto_assign on: the active sales rep (sales use) after the one who got the last
 * automatic lead, in a fixed order. Null when it is off or there are no reps.
 */
export async function roundRobinOwner(tx: Tx): Promise<string | null> {
  if ((await getSetting(tx, 'sales.auto_assign')) !== 1) return null;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('crm_round_robin'))`;
  const reps = await tx.user.findMany({
    where: { isActive: true, role: { in: [...TEAM_ROLES] }, access: { sales: 'use' } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  if (reps.length === 0) return null;
  const last = await tx.crmDeal.findFirst({
    where: { autoAssigned: true },
    orderBy: { number: 'desc' },
    select: { ownerId: true },
  });
  const at = last?.ownerId ? reps.findIndex((r) => r.id > last.ownerId!) : 0;
  return reps[at === -1 ? 0 : at]!.id;
}

// ─── phones ─────────────────────────────────────────────────────────────────────

/** A valid Egyptian mobile becomes +20 and 10 digits; anything else is kept as typed, flagged. */
export function crmPhone(input: string | null | undefined) {
  if (!input) return { phone: null, phoneValid: false };
  const normalized = normalizeEgyptianPhone(latinDigits(input));
  return { phone: normalized ?? input, phoneValid: normalized !== null };
}

// ─── lost reasons ───────────────────────────────────────────────────────────────

/** Adds the default lost reasons that are missing (the seed; never overwrites edits). */
export async function ensureLostReasons(db: Db) {
  let order = 10;
  for (const r of DEFAULT_LOST_REASONS) {
    await db.crmLostReason.upsert({
      where: { code: r.code },
      update: {},
      create: { ...r, sortOrder: order },
    });
    order += 10;
  }
}

export function listLostReasons(db: Db, options: { all?: boolean } = {}) {
  return db.crmLostReason.findMany({
    where: options.all ? {} : { active: true },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
  });
}

export async function createLostReason(db: Db, body: CrmLostReasonBody, actor: CrmActor) {
  need(actor, 'manage');
  return inTransaction(db, async (tx) => {
    if (await tx.crmLostReason.findUnique({ where: { code: body.code } }))
      throw new DomainError('lost_reason_exists');
    const max = await tx.crmLostReason.aggregate({ _max: { sortOrder: true } });
    const row = await tx.crmLostReason.create({
      data: { ...body, sortOrder: (max._max.sortOrder ?? 0) + 10 },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      action: 'crm_lost_reason.create',
      entityType: 'crm_lost_reason',
      entityId: row.code,
      after: { labelEn: row.labelEn, labelAr: row.labelAr },
    });
    return row;
  });
}

export async function updateLostReason(
  db: Db,
  code: string,
  body: CrmLostReasonUpdateBody,
  actor: CrmActor,
) {
  need(actor, 'manage');
  return inTransaction(db, async (tx) => {
    const before = await tx.crmLostReason.findUnique({ where: { code } });
    if (!before) throw new DomainError('lost_reason_not_found', 404);
    const row = await tx.crmLostReason.update({ where: { code }, data: body });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      action: 'crm_lost_reason.update',
      entityType: 'crm_lost_reason',
      entityId: code,
      before: {
        labelEn: before.labelEn,
        labelAr: before.labelAr,
        active: before.active,
        sortOrder: before.sortOrder,
      },
      after: {
        labelEn: row.labelEn,
        labelAr: row.labelAr,
        active: row.active,
        sortOrder: row.sortOrder,
      },
    });
    return row;
  });
}

// ─── opening deals ──────────────────────────────────────────────────────────────

interface CompanyInput {
  brandName: string;
  website?: string | null;
  shopDomain?: string | null;
  category?: string | null;
  city?: string | null;
  expectedMonthlyOrders?: number | null;
  source: CrmSource;
  note?: string | null;
  merchantId?: string | null;
  siteLeadId?: string | null;
  idempotencyKey?: string | null;
}
interface ContactInput {
  name: string;
  role?: string | null;
  phone?: string | null;
  email?: string | null;
  whatsapp?: boolean;
}

function companySnapshot(c: {
  brandName: string;
  website: string | null;
  shopDomain: string | null;
  category: string | null;
  city: string | null;
  expectedMonthlyOrders: number | null;
  source: string;
  ownerId: string | null;
  merchantId: string | null;
  note: string | null;
}) {
  return {
    brandName: c.brandName,
    website: c.website,
    shopDomain: c.shopDomain,
    category: c.category,
    city: c.city,
    expectedMonthlyOrders: c.expectedMonthlyOrders,
    source: c.source,
    ownerId: c.ownerId,
    merchantId: c.merchantId,
    note: c.note,
  };
}

function dealSnapshot(d: {
  title: string | null;
  ownerId: string | null;
  stage: string;
  expectedMonthlyOrders: number | null;
  expectedMonthlyFeePiastres: number | null;
  expectedCloseDate: Date | null;
  lostReason: string | null;
  lostNote: string | null;
  merchantId: string | null;
}) {
  return {
    title: d.title,
    ownerId: d.ownerId,
    stage: d.stage,
    expectedMonthlyOrders: d.expectedMonthlyOrders,
    expectedMonthlyFeePiastres: d.expectedMonthlyFeePiastres,
    expectedCloseDate: d.expectedCloseDate?.toISOString().slice(0, 10) ?? null,
    lostReason: d.lostReason,
    lostNote: d.lostNote,
    merchantId: d.merchantId,
  };
}

async function createCompanyRow(
  tx: Tx,
  input: CompanyInput,
  ownerId: string | null,
  actorUserId: string | null,
) {
  const company = await tx.crmCompany.create({
    data: {
      brandName: input.brandName,
      website: input.website ?? null,
      shopDomain: input.shopDomain ?? null,
      category: input.category ?? null,
      city: input.city ?? null,
      expectedMonthlyOrders: input.expectedMonthlyOrders ?? null,
      source: input.source,
      note: input.note ?? null,
      merchantId: input.merchantId ?? null,
      siteLeadId: input.siteLeadId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      ownerId,
    },
  });
  await recordAudit(tx, {
    actorUserId,
    action: 'crm_company.create',
    entityType: 'crm_company',
    entityId: company.id,
    after: companySnapshot(company),
  });
  return company;
}

async function createContactRow(
  tx: Tx,
  companyId: string,
  input: ContactInput,
  actorUserId: string | null,
) {
  const contact = await tx.crmContact.create({
    data: {
      companyId,
      name: input.name,
      role: input.role ?? null,
      email: input.email ?? null,
      whatsapp: input.whatsapp ?? false,
      ...crmPhone(input.phone),
    },
  });
  await recordAudit(tx, {
    actorUserId,
    action: 'crm_contact.create',
    entityType: 'crm_company',
    entityId: companyId,
    after: { contact: contact.name, phone: contact.phone, phoneValid: contact.phoneValid },
  });
  return contact;
}

/** Opens a deal at stage new with its first history row, numbered DEAL-000001 onward. */
async function openDealRow(
  tx: Tx,
  input: {
    companyId: string;
    ownerId: string | null;
    autoAssigned?: boolean;
    title?: string | null;
    expectedMonthlyOrders?: number | null;
    expectedMonthlyFeePiastres?: number | null;
    expectedCloseDate?: string | null;
    merchantId?: string | null;
    idempotencyKey?: string | null;
    actorUserId: string | null;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const deal = await tx.crmDeal.create({
    data: {
      number: await nextNumber(tx, 'crm_deals'),
      companyId: input.companyId,
      ownerId: input.ownerId,
      ownerAssignedAt: input.ownerId ? now : null,
      ownerAssignedById: input.ownerId ? input.actorUserId : null,
      autoAssigned: input.autoAssigned ?? false,
      title: input.title ?? null,
      expectedMonthlyOrders: input.expectedMonthlyOrders ?? null,
      expectedMonthlyFeePiastres: input.expectedMonthlyFeePiastres ?? null,
      expectedCloseDate: input.expectedCloseDate ? new Date(input.expectedCloseDate) : null,
      merchantId: input.merchantId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      createdById: input.actorUserId,
      stageChangedAt: now,
      createdAt: now,
    },
  });
  await tx.crmDealStageHistory.create({
    data: {
      dealId: deal.id,
      fromStage: null,
      toStage: 'new',
      changedById: input.actorUserId,
      changedAt: now,
    },
  });
  await recordAudit(tx, {
    actorUserId: input.actorUserId,
    action: 'crm_deal.create',
    entityType: 'crm_deal',
    entityId: deal.id,
    after: {
      number: dealNumber(deal.number),
      ...dealSnapshot(deal),
      autoAssigned: deal.autoAssigned,
    },
  });
  return deal;
}

/**
 * A website form lead (inside createSiteLead's transaction): a company named after the
 * website (or the person), the person as its contact and a new deal with the orders estimate
 * of the band they picked. It waits for a manager unless the round robin is on.
 */
export async function leadFromSiteForm(
  tx: Tx,
  lead: {
    id: string;
    name: string;
    phone: string;
    website: string | null;
    ordersBand: string;
    idempotencyKey: string;
  },
) {
  const estimate = ORDERS_BAND_ESTIMATE[lead.ordersBand as OrdersBand] ?? null;
  const host = lead.website
    ?.toLowerCase()
    .replace(/^(https?:\/\/)?(www\.)?/, '')
    .split(/[/?#]/)[0];
  const ownerId = await roundRobinOwner(tx);
  const company = await createCompanyRow(
    tx,
    {
      brandName: host || lead.name,
      website: lead.website,
      expectedMonthlyOrders: estimate,
      source: 'website_form',
      siteLeadId: lead.id,
    },
    ownerId,
    null,
  );
  await createContactRow(tx, company.id, { name: lead.name, phone: lead.phone }, null);
  const deal = await openDealRow(tx, {
    companyId: company.id,
    ownerId,
    autoAssigned: ownerId !== null,
    expectedMonthlyOrders: estimate,
    idempotencyKey: `site_lead:${lead.idempotencyKey}`,
    actorUserId: null,
  });
  return { companyId: company.id, dealId: deal.id };
}

/** A merchant who signed up (inside signUpMerchant's transaction) becomes a lead to onboard. */
export async function leadFromSignup(
  tx: Tx,
  input: {
    merchantId: string;
    businessName: string;
    contactName: string;
    email: string;
    phone: string;
    shopDomain?: string | null;
  },
) {
  const ownerId = await roundRobinOwner(tx);
  const company = await createCompanyRow(
    tx,
    {
      brandName: input.businessName,
      shopDomain: input.shopDomain ?? null,
      source: 'signup',
      merchantId: input.merchantId,
    },
    ownerId,
    null,
  );
  await createContactRow(
    tx,
    company.id,
    { name: input.contactName, phone: input.phone, email: input.email },
    null,
  );
  const deal = await openDealRow(tx, {
    companyId: company.id,
    ownerId,
    autoAssigned: ownerId !== null,
    merchantId: input.merchantId,
    idempotencyKey: `signup:${input.merchantId}`,
    actorUserId: null,
  });
  return { companyId: company.id, dealId: deal.id };
}

/**
 * A rep or manager adds a deal by hand: for a company we have, or a new company with its first
 * contact. A rep's deal is theirs; a manager's waits in the queue unless they name an owner.
 */
export async function createDeal(db: Db, body: CrmDealCreateBody, actor: CrmActor) {
  need(actor, 'use');
  const existing = await db.crmDeal.findUnique({
    where: { idempotencyKey: body.idempotencyKey },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };
  try {
    return await inTransaction(db, async (tx) => {
      const ownerId = await ownerFor(
        tx,
        actor,
        body.ownerId,
        actor.level === 'manage' ? null : actor.userId,
      );
      let companyId: string;
      if (body.companyId) {
        companyId = (await companyFor(tx, body.companyId, actor)).id;
        if (body.contact) await createContactRow(tx, companyId, body.contact, actor.userId);
      } else {
        const company = await createCompanyRow(
          tx,
          { ...body.company!, source: body.company!.source ?? 'manual' },
          ownerId,
          actor.userId,
        );
        companyId = company.id;
        if (body.contact) await createContactRow(tx, companyId, body.contact, actor.userId);
      }
      const company = await tx.crmCompany.findUniqueOrThrow({ where: { id: companyId } });
      const deal = await openDealRow(tx, {
        companyId,
        ownerId,
        title: body.title,
        expectedMonthlyOrders: body.expectedMonthlyOrders ?? company.expectedMonthlyOrders,
        expectedMonthlyFeePiastres: body.expectedMonthlyFeePiastres,
        expectedCloseDate: body.expectedCloseDate,
        merchantId: company.merchantId,
        idempotencyKey: body.idempotencyKey,
        actorUserId: actor.userId,
      });
      return { id: deal.id, created: true };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const again = await db.crmDeal.findUnique({
        where: { idempotencyKey: body.idempotencyKey },
        select: { id: true },
      });
      if (again) return { id: again.id, created: false };
    }
    throw error;
  }
}

// ─── reading deals ──────────────────────────────────────────────────────────────

const nextStepSelect = {
  where: { doneAt: null, dueAt: { not: null } },
  orderBy: { dueAt: 'asc' },
  take: 1,
  select: { id: true, type: true, subject: true, dueAt: true },
} satisfies Prisma.CrmDeal$activitiesArgs;

const cardSelect = {
  id: true,
  number: true,
  title: true,
  stage: true,
  expectedMonthlyOrders: true,
  expectedMonthlyFeePiastres: true,
  expectedCloseDate: true,
  stageChangedAt: true,
  wonAt: true,
  lostAt: true,
  lostReason: true,
  createdAt: true,
  company: { select: { id: true, brandName: true, source: true, city: true } },
  owner: { select: { id: true, name: true } },
  activities: nextStepSelect,
} satisfies Prisma.CrmDealSelect;

type CardRow = Prisma.CrmDealGetPayload<{ select: typeof cardSelect }>;

function toCard(d: CardRow) {
  const { activities, ...rest } = d;
  return {
    ...rest,
    label: dealNumber(d.number),
    expectedCloseDate: d.expectedCloseDate?.toISOString().slice(0, 10) ?? null,
    nextStep: activities[0] ?? null,
  };
}
export type DealCard = ReturnType<typeof toCard>;

export interface DealFilter {
  /** One owner's deals (managers and reps without own_deals_only) */
  ownerId?: string;
  /** Only deals nobody owns yet (the managers' queue) */
  unassigned?: boolean;
  source?: CrmSource;
  stages?: CrmStage[];
  /** Leave out won and lost */
  openOnly?: boolean;
  /** Open deals without a planned next step */
  needsNextStep?: boolean;
  /** Company, contact name or phone, or the deal number */
  q?: string;
  take?: number;
}

/** Deals the actor may see, newest first, as the board's cards. */
export async function listDeals(db: Db, actor: CrmActor, filter: DealFilter = {}) {
  need(actor, 'view');
  const and: Prisma.CrmDealWhereInput[] = [dealScope(actor)];
  if (filter.ownerId && !actor.ownOnly) and.push({ ownerId: filter.ownerId });
  if (filter.unassigned) and.push({ ownerId: null });
  if (filter.source) and.push({ company: { source: filter.source } });
  if (filter.stages?.length) and.push({ stage: { in: filter.stages } });
  if (filter.openOnly || filter.needsNextStep) and.push({ stage: { in: [...CRM_OPEN_STAGES] } });
  if (filter.needsNextStep)
    and.push({ activities: { none: { doneAt: null, dueAt: { not: null } } } });
  const q = filter.q?.trim();
  if (q) {
    const number = /^(deal-)?0*(\d{1,9})$/i.exec(q);
    const phone = normalizeEgyptianPhone(latinDigits(q));
    and.push({
      OR: [
        ...(number ? [{ number: Number(number[2]) }] : []),
        { title: { contains: q, mode: 'insensitive' } },
        { company: { brandName: { contains: q, mode: 'insensitive' } } },
        { company: { website: { contains: q, mode: 'insensitive' } } },
        { company: { contacts: { some: { name: { contains: q, mode: 'insensitive' } } } } },
        { company: { contacts: { some: { phone: phone ?? q } } } },
      ],
    });
  }
  const rows = await db.crmDeal.findMany({
    where: { AND: and },
    select: cardSelect,
    orderBy: [{ stageChangedAt: 'desc' }, { number: 'desc' }],
    take: Math.min(filter.take ?? 500, 2000),
  });
  return rows.map(toCard);
}

/** One deal with its company, contacts, activities (newest first) and stage history. */
export async function getDeal(db: Db, id: string, actor: CrmActor) {
  need(actor, 'view');
  await dealFor(db, id, actor);
  const deal = await db.crmDeal.findUniqueOrThrow({
    where: { id },
    include: {
      company: { include: { contacts: { orderBy: { createdAt: 'asc' } } } },
      owner: { select: { id: true, name: true } },
      merchant: { select: { id: true, name: true } },
      history: {
        orderBy: { changedAt: 'desc' },
        include: { changedBy: { select: { name: true } } },
      },
      activities: {
        include: {
          owner: { select: { id: true, name: true } },
          createdBy: { select: { name: true } },
        },
      },
    },
  });
  const lostReason = deal.lostReason
    ? await db.crmLostReason.findUnique({ where: { code: deal.lostReason } })
    : null;
  const { activities, ...rest } = deal;
  const open = activities
    .filter((a) => !a.doneAt && a.dueAt)
    .sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime());
  return {
    ...rest,
    label: dealNumber(deal.number),
    expectedCloseDate: deal.expectedCloseDate?.toISOString().slice(0, 10) ?? null,
    lostReasonLabel: lostReason
      ? { en: lostReason.labelEn, ar: lostReason.labelAr }
      : deal.lostReason
        ? { en: deal.lostReason, ar: deal.lostReason }
        : null,
    nextStep: open[0] ?? null,
    activities: sortTimeline(activities),
  };
}

/** Newest first: done ones by when they were done, planned ones by their date. */
function sortTimeline<T extends { doneAt: Date | null; dueAt: Date | null; createdAt: Date }>(
  list: T[],
) {
  const when = (a: T) => (a.doneAt ?? a.dueAt ?? a.createdAt).getTime();
  return [...list].sort((a, b) => when(b) - when(a));
}

/** The deal's audit trail (the History panel), after the same scope check as the deal. */
export async function dealAudit(db: Db, id: string, actor: CrmActor) {
  need(actor, 'view');
  await dealFor(db, id, actor);
  const rows = await db.auditLog.findMany({
    where: { entityType: 'crm_deal', entityId: id },
    include: { actor: { select: { name: true, role: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 100,
  });
  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt,
    action: r.action,
    actor: r.actor ? { name: r.actor.name, role: r.actor.role } : null,
    before: r.before as unknown,
    after: r.after as unknown,
  }));
}

// ─── changing deals ─────────────────────────────────────────────────────────────

export async function updateDeal(db: Db, id: string, body: CrmDealUpdateBody, actor: CrmActor) {
  need(actor, 'use');
  return inTransaction(db, async (tx) => {
    const before = await dealFor(tx, id, actor);
    if (body.merchantId) {
      const merchant = await tx.merchant.findUnique({ where: { id: body.merchantId } });
      if (!merchant) throw new DomainError('merchant_not_found', 404);
    }
    const deal = await tx.crmDeal.update({
      where: { id },
      data: {
        title: body.title,
        expectedMonthlyOrders: body.expectedMonthlyOrders,
        expectedMonthlyFeePiastres: body.expectedMonthlyFeePiastres,
        expectedCloseDate:
          body.expectedCloseDate === undefined
            ? undefined
            : body.expectedCloseDate
              ? new Date(body.expectedCloseDate)
              : null,
        merchantId: body.merchantId,
      },
    });
    // A deal linked to a merchant links its company too, when the company has none yet.
    if (body.merchantId && !before.company.merchantId)
      await tx.crmCompany.update({
        where: { id: before.companyId },
        data: { merchantId: body.merchantId },
      });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      action: 'crm_deal.update',
      entityType: 'crm_deal',
      entityId: id,
      before: dealSnapshot(before),
      after: dealSnapshot(deal),
    });
    return deal;
  });
}

/**
 * Moves a deal to another stage and keeps the step in its history. Lost needs a reason from
 * the list (or "other" with a note); won and lost stamp their time; leaving them clears it.
 * The deal's stale alerts are handled, since it moved.
 */
export async function changeStage(
  db: Db,
  id: string,
  body: CrmStageBody,
  actor: CrmActor,
  now: Date = new Date(),
) {
  need(actor, 'use');
  return inTransaction(db, async (tx) => {
    const before = await dealFor(tx, id, actor);
    if (before.stage === body.stage) throw new DomainError('same_stage');
    let lostReason: string | null = null;
    let lostNote: string | null = null;
    if (body.stage === 'lost') {
      if (!body.lostReason) throw new DomainError('lost_reason_required', 400);
      if (body.lostReason === LOST_REASON_OTHER) {
        if (!body.lostNote?.trim()) throw new DomainError('lost_note_required', 400);
      } else {
        const reason = await tx.crmLostReason.findUnique({ where: { code: body.lostReason } });
        if (!reason?.active) throw new DomainError('lost_reason_unknown', 400);
      }
      lostReason = body.lostReason;
      lostNote = body.lostNote?.trim() || null;
    }
    const deal = await tx.crmDeal.update({
      where: { id },
      data: {
        stage: body.stage,
        stageChangedAt: now,
        wonAt: body.stage === 'won' ? now : null,
        lostAt: body.stage === 'lost' ? now : null,
        lostReason,
        lostNote,
      },
    });
    await tx.crmDealStageHistory.create({
      data: {
        dealId: id,
        fromStage: before.stage,
        toStage: body.stage,
        changedById: actor.userId,
        changedAt: now,
        lostReason,
        note: lostNote,
      },
    });
    await tx.alert.updateMany({
      where: {
        type: 'crm_deal_stale',
        resolvedAt: null,
        key: { startsWith: `crm_deal_stale:${id}:` },
      },
      data: { resolvedAt: now, resolvedById: actor.userId },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      action: 'crm_deal.stage',
      entityType: 'crm_deal',
      entityId: id,
      before: { stage: before.stage, lostReason: before.lostReason, lostNote: before.lostNote },
      after: { stage: deal.stage, lostReason: deal.lostReason, lostNote: deal.lostNote },
    });
    return deal;
  });
}

/**
 * A manager gives a deal to a rep (or back to the queue). The company follows when it had no
 * owner or the old one, and the old owner's open follow ups on the deal move with it.
 */
export async function assignDeal(
  db: Db,
  id: string,
  ownerId: string | null,
  actor: CrmActor,
  now: Date = new Date(),
) {
  need(actor, 'manage');
  return inTransaction(db, async (tx) => {
    const before = await dealFor(tx, id, actor);
    if (ownerId) await assertOwner(tx, ownerId);
    if (before.ownerId === ownerId) return before;
    const deal = await tx.crmDeal.update({
      where: { id },
      data: {
        ownerId,
        ownerAssignedAt: ownerId ? now : null,
        ownerAssignedById: ownerId ? actor.userId : null,
        autoAssigned: false,
      },
    });
    if (!before.company.ownerId || before.company.ownerId === before.ownerId)
      await tx.crmCompany.update({ where: { id: before.companyId }, data: { ownerId } });
    if (before.ownerId && ownerId)
      await tx.crmActivity.updateMany({
        where: { dealId: id, ownerId: before.ownerId, doneAt: null },
        data: { ownerId },
      });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      action: 'crm_deal.assign',
      entityType: 'crm_deal',
      entityId: id,
      before: { ownerId: before.ownerId },
      after: { ownerId },
    });
    return deal;
  });
}

// ─── activities ─────────────────────────────────────────────────────────────────

/**
 * Logs what happened (done) or plans a next step (a due date). On a deal or a company; the
 * owner is the person who adds it unless a manager names another sales person.
 */
export async function createActivity(
  db: Db,
  body: CrmActivityBody,
  actor: CrmActor,
  now: Date = new Date(),
) {
  need(actor, 'use');
  const existing = await db.crmActivity.findUnique({
    where: { idempotencyKey: body.idempotencyKey },
  });
  if (existing) return existing;
  return inTransaction(db, async (tx) => {
    let companyId: string;
    let dealId: string | null = null;
    if (body.dealId) {
      const deal = await dealFor(tx, body.dealId, actor);
      companyId = deal.companyId;
      dealId = deal.id;
    } else {
      companyId = (await companyFor(tx, body.companyId!, actor)).id;
    }
    const ownerId = (await ownerFor(tx, actor, body.ownerId, actor.userId)) ?? actor.userId;
    const activity = await tx.crmActivity.create({
      data: {
        companyId,
        dealId,
        type: body.type,
        subject: body.subject,
        notes: body.notes ?? null,
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
        doneAt: body.done ? now : null,
        outcome: body.outcome ?? null,
        ownerId,
        createdById: actor.userId,
        idempotencyKey: body.idempotencyKey,
        createdAt: now,
      },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      action: body.done ? 'crm_activity.log' : 'crm_activity.plan',
      entityType: dealId ? 'crm_deal' : 'crm_company',
      entityId: dealId ?? companyId,
      after: {
        activityId: activity.id,
        type: activity.type,
        subject: activity.subject,
        dueAt: activity.dueAt?.toISOString() ?? null,
        ownerId,
      },
    });
    return activity;
  });
}

export async function updateActivity(
  db: Db,
  id: string,
  body: CrmActivityUpdateBody,
  actor: CrmActor,
) {
  need(actor, 'use');
  return inTransaction(db, async (tx) => {
    const before = await activityFor(tx, id, actor);
    const dueAt = body.dueAt === undefined ? undefined : body.dueAt ? new Date(body.dueAt) : null;
    if (dueAt === null && !before.doneAt) throw new DomainError('due_required', 400);
    const moved = dueAt !== undefined && dueAt?.getTime() !== before.dueAt?.getTime();
    const activity = await tx.crmActivity.update({
      where: { id },
      data: {
        subject: body.subject,
        notes: body.notes,
        outcome: body.outcome,
        dueAt,
        // A new date is a new reminder.
        ...(moved && { dueNotifiedAt: null }),
      },
    });
    if (moved)
      await tx.alert.updateMany({
        where: { key: `crm_followup_overdue:${id}`, resolvedAt: null },
        data: { resolvedAt: new Date(), resolvedById: actor.userId },
      });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      action: 'crm_activity.update',
      entityType: before.dealId ? 'crm_deal' : 'crm_company',
      entityId: before.dealId ?? before.companyId,
      before: {
        activityId: id,
        subject: before.subject,
        dueAt: before.dueAt?.toISOString() ?? null,
        outcome: before.outcome,
      },
      after: {
        activityId: id,
        subject: activity.subject,
        dueAt: activity.dueAt?.toISOString() ?? null,
        outcome: activity.outcome,
      },
    });
    return activity;
  });
}

/** Marks a follow up done (with what came of it) and handles its overdue alert. */
export async function completeActivity(
  db: Db,
  id: string,
  outcome: string | null | undefined,
  actor: CrmActor,
  now: Date = new Date(),
) {
  need(actor, 'use');
  return inTransaction(db, async (tx) => {
    const before = await activityFor(tx, id, actor);
    if (before.doneAt) throw new DomainError('activity_done');
    const activity = await tx.crmActivity.update({
      where: { id },
      data: { doneAt: now, outcome: outcome ?? before.outcome },
    });
    await tx.alert.updateMany({
      where: { key: `crm_followup_overdue:${id}`, resolvedAt: null },
      data: { resolvedAt: now, resolvedById: actor.userId },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      action: 'crm_activity.done',
      entityType: before.dealId ? 'crm_deal' : 'crm_company',
      entityId: before.dealId ?? before.companyId,
      before: { activityId: id, done: false },
      after: { activityId: id, done: true, outcome: activity.outcome },
    });
    return activity;
  });
}

const activityRowSelect = {
  id: true,
  type: true,
  subject: true,
  notes: true,
  dueAt: true,
  doneAt: true,
  outcome: true,
  owner: { select: { id: true, name: true } },
  company: { select: { id: true, brandName: true } },
  deal: { select: { id: true, number: true, stage: true } },
} satisfies Prisma.CrmActivitySelect;

/**
 * My day: open follow ups that are overdue or due today (Cairo), and my open deals without a
 * next step. A manager may look at one rep (ownerId) or everyone (all).
 */
export async function myDay(
  db: Db,
  actor: CrmActor,
  options: { ownerId?: string; all?: boolean } = {},
  now: Date = new Date(),
) {
  need(actor, 'view');
  const canPick = actor.level === 'manage' || !actor.ownOnly;
  const ownerId = canPick && options.ownerId ? options.ownerId : actor.userId;
  const everyone = canPick && options.all === true;
  const dayEnd = cairoDayStart(addDays(cairoDay(now), 1));
  const who: Prisma.CrmActivityWhereInput = everyone ? {} : { ownerId };
  const rows = await db.crmActivity.findMany({
    where: { AND: [activityScope(actor), who, { doneAt: null, dueAt: { lt: dayEnd } }] },
    select: activityRowSelect,
    orderBy: { dueAt: 'asc' },
    take: 500,
  });
  const map = (a: (typeof rows)[number]) => ({
    ...a,
    deal: a.deal ? { ...a.deal, label: dealNumber(a.deal.number) } : null,
  });
  const needsNextStep = await listDeals(db, actor, {
    needsNextStep: true,
    ...(everyone ? {} : { ownerId }),
    take: 200,
  });
  return {
    ownerId: everyone ? null : ownerId,
    overdue: rows.filter((a) => a.dueAt! < now).map(map),
    today: rows.filter((a) => a.dueAt! >= now).map(map),
    needsNextStep,
  };
}

// ─── companies and contacts ─────────────────────────────────────────────────────

export async function listCompanies(db: Db, actor: CrmActor, filter: { q?: string } = {}) {
  need(actor, 'view');
  const q = filter.q?.trim();
  const rows = await db.crmCompany.findMany({
    where: {
      AND: [
        companyScope(actor),
        q
          ? {
              OR: [
                { brandName: { contains: q, mode: 'insensitive' } },
                { website: { contains: q, mode: 'insensitive' } },
                { shopDomain: { contains: q, mode: 'insensitive' } },
                { contacts: { some: { name: { contains: q, mode: 'insensitive' } } } },
              ],
            }
          : {},
      ],
    },
    include: {
      owner: { select: { id: true, name: true } },
      merchant: { select: { id: true, name: true } },
      deals: { select: { id: true, stage: true } },
      _count: { select: { contacts: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 500,
  });
  return rows.map(({ deals, _count, ...c }) => ({
    ...c,
    contacts: _count.contacts,
    openDeals: deals.filter((d) => isOpenStage(d.stage)).length,
    wonDeals: deals.filter((d) => d.stage === 'won').length,
  }));
}

export async function getCompany(db: Db, id: string, actor: CrmActor) {
  need(actor, 'view');
  await companyFor(db, id, actor);
  const company = await db.crmCompany.findUniqueOrThrow({
    where: { id },
    include: {
      owner: { select: { id: true, name: true } },
      merchant: { select: { id: true, name: true } },
      contacts: { orderBy: { createdAt: 'asc' } },
      deals: {
        where: dealScope(actor),
        select: cardSelect,
        orderBy: { number: 'desc' },
      },
      activities: {
        where: activityScope(actor),
        include: {
          owner: { select: { id: true, name: true } },
          deal: { select: { id: true, number: true } },
        },
      },
    },
  });
  return {
    ...company,
    deals: company.deals.map(toCard),
    activities: sortTimeline(company.activities).map((a) => ({
      ...a,
      deal: a.deal ? { ...a.deal, label: dealNumber(a.deal.number) } : null,
    })),
  };
}

export async function createCompany(db: Db, body: CrmCompanyBody, actor: CrmActor) {
  need(actor, 'use');
  const existing = await db.crmCompany.findUnique({
    where: { idempotencyKey: body.idempotencyKey },
  });
  if (existing) return existing;
  return inTransaction(db, async (tx) => {
    const ownerId = await ownerFor(tx, actor, body.ownerId, actor.userId);
    const { ownerId: _o, ...input } = body;
    return createCompanyRow(tx, input, ownerId, actor.userId);
  });
}

export async function updateCompany(
  db: Db,
  id: string,
  body: CrmCompanyUpdateBody,
  actor: CrmActor,
) {
  need(actor, 'use');
  return inTransaction(db, async (tx) => {
    const before = await companyFor(tx, id, actor);
    if (body.merchantId) {
      const merchant = await tx.merchant.findUnique({ where: { id: body.merchantId } });
      if (!merchant) throw new DomainError('merchant_not_found', 404);
    }
    const company = await tx.crmCompany.update({ where: { id }, data: body });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      action: 'crm_company.update',
      entityType: 'crm_company',
      entityId: id,
      before: companySnapshot(before),
      after: companySnapshot(company),
    });
    return company;
  });
}

export async function addContact(db: Db, companyId: string, body: CrmContactBody, actor: CrmActor) {
  need(actor, 'use');
  return inTransaction(db, async (tx) => {
    await companyFor(tx, companyId, actor);
    return createContactRow(tx, companyId, body, actor.userId);
  });
}

export async function updateContact(
  db: Db,
  id: string,
  body: CrmContactUpdateBody,
  actor: CrmActor,
) {
  need(actor, 'use');
  return inTransaction(db, async (tx) => {
    const before = await tx.crmContact.findUnique({ where: { id } });
    if (!before) throw new DomainError('contact_not_found', 404);
    await companyFor(tx, before.companyId, actor);
    const { phone, ...rest } = body;
    const contact = await tx.crmContact.update({
      where: { id },
      data: { ...rest, ...(phone !== undefined && crmPhone(phone)) },
    });
    await recordAudit(tx, {
      actorUserId: actor.userId,
      action: 'crm_contact.update',
      entityType: 'crm_company',
      entityId: before.companyId,
      before: { contact: before.name, phone: before.phone, email: before.email, role: before.role },
      after: {
        contact: contact.name,
        phone: contact.phone,
        email: contact.email,
        role: contact.role,
      },
    });
    return contact;
  });
}

// ─── reminders (API job) ────────────────────────────────────────────────────────

/**
 * The CRM reminder job. Safe to run any number of times:
 * - a follow up that became due is marked once (due_notified_at); the push dispatcher tells
 *   its owner,
 * - one crm_followup_overdue alert per follow up open sales.overdue_minutes after it was due,
 * - one crm_deal_stale alert per deal and stage stay longer than sales.stale_days.
 * Alert keys hold the record (and for deals the time it entered the stage).
 */
export async function crmReminders(db: Db, now: Date = new Date()) {
  const overdueMinutes = await getSetting(db, 'sales.overdue_minutes');
  const staleDays = await getSetting(db, 'sales.stale_days');
  // Follow ups due in the last day only: an old one is the overdue alert's job.
  const due = await db.crmActivity.updateMany({
    where: {
      doneAt: null,
      dueNotifiedAt: null,
      dueAt: { lte: now, gt: new Date(now.getTime() - 24 * 60 * 60_000) },
    },
    data: { dueNotifiedAt: now },
  });

  const overdue = await db.crmActivity.findMany({
    where: { doneAt: null, dueAt: { lte: new Date(now.getTime() - overdueMinutes * 60_000) } },
    select: {
      id: true,
      subject: true,
      dueAt: true,
      ownerId: true,
      owner: { select: { name: true } },
      company: { select: { brandName: true } },
      deal: { select: { id: true, number: true } },
    },
    take: 1000,
  });
  const overdueAlerts = await db.alert.createMany({
    data: overdue.map((a) => ({
      type: 'crm_followup_overdue',
      key: `crm_followup_overdue:${a.id}`,
      data: {
        activityId: a.id,
        dealId: a.deal?.id ?? null,
        number: a.deal ? dealNumber(a.deal.number) : '',
        company: a.company.brandName,
        subject: a.subject,
        ownerId: a.ownerId,
        owner: a.owner.name,
        dueAt: a.dueAt!.toISOString(),
        minutes: Math.floor((now.getTime() - a.dueAt!.getTime()) / 60_000),
      },
    })),
    skipDuplicates: true,
  });

  const stale = await db.crmDeal.findMany({
    where: {
      stage: { in: [...CRM_OPEN_STAGES] },
      stageChangedAt: { lte: new Date(now.getTime() - staleDays * 24 * 60 * 60_000) },
    },
    select: {
      id: true,
      number: true,
      stage: true,
      stageChangedAt: true,
      ownerId: true,
      owner: { select: { name: true } },
      company: { select: { brandName: true } },
    },
    take: 1000,
  });
  const staleAlerts = await db.alert.createMany({
    data: stale.map((d) => ({
      type: 'crm_deal_stale',
      key: `crm_deal_stale:${d.id}:${d.stage}:${d.stageChangedAt.getTime()}`,
      data: {
        dealId: d.id,
        number: dealNumber(d.number),
        company: d.company.brandName,
        stage: d.stage,
        days: Math.floor((now.getTime() - d.stageChangedAt.getTime()) / (24 * 60 * 60_000)),
        ownerId: d.ownerId,
        owner: d.owner?.name ?? null,
      },
    })),
    skipDuplicates: true,
  });
  return { due: due.count, overdue: overdueAlerts.count, stale: staleAlerts.count };
}
