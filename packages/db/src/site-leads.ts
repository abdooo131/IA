import { Prisma } from '@prisma/client';
import {
  normalizeEgyptianPhone,
  latinDigits,
  type SiteLeadBody,
  type SiteLeadStatus,
  type SiteLeadUpdateBody,
} from '@shiplynow/shared';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';

// Leads from the public website's contact form (docs/ARCHITECTURE.md, Public website).
//
//   form ──▶ new ──▶ contacted ──▶ won
//                         └───────▶ lost      (admin may move between any of them)
//
// Each submission carries the form's idempotency key, so a double tap or a retry makes one
// lead and one site_lead alert.

const select = {
  id: true,
  name: true,
  phone: true,
  phoneValid: true,
  website: true,
  ordersBand: true,
  locale: true,
  status: true,
  note: true,
  createdAt: true,
  updatedAt: true,
  handledBy: { select: { id: true, name: true } },
} satisfies Prisma.SiteLeadSelect;

export type SiteLeadRow = Prisma.SiteLeadGetPayload<{ select: typeof select }>;

/** The lead a submission with this key already made, if any. */
export function findSiteLeadByKey(db: Db, idempotencyKey: string) {
  return db.siteLead.findUnique({ where: { idempotencyKey }, select: { id: true } });
}

/**
 * Stores a lead and raises one site_lead admin alert, in one transaction. A valid Egyptian
 * mobile is kept as +20 and 10 digits; anything else is kept as typed and flagged.
 */
export async function createSiteLead(db: Db, input: SiteLeadBody) {
  const existing = await findSiteLeadByKey(db, input.idempotencyKey);
  if (existing) return { id: existing.id, created: false };
  const normalized = normalizeEgyptianPhone(latinDigits(input.phone));
  try {
    return await inTransaction(db, async (tx) => {
      const lead = await tx.siteLead.create({
        data: {
          name: input.name,
          phone: normalized ?? input.phone,
          phoneValid: normalized !== null,
          website: input.website,
          ordersBand: input.ordersBand,
          locale: input.locale,
          idempotencyKey: input.idempotencyKey,
        },
      });
      await tx.alert.create({
        data: {
          type: 'site_lead',
          key: `site_lead:${lead.id}`,
          data: {
            leadId: lead.id,
            name: lead.name,
            phone: lead.phone,
            phoneValid: lead.phoneValid,
            ordersBand: lead.ordersBand,
          },
        },
      });
      await recordAudit(tx, {
        actorUserId: null,
        action: 'site_lead.create',
        entityType: 'site_lead',
        entityId: lead.id,
        after: {
          name: lead.name,
          phone: lead.phone,
          phoneValid: lead.phoneValid,
          website: lead.website,
          ordersBand: lead.ordersBand,
          locale: lead.locale,
        },
      });
      return { id: lead.id, created: true };
    });
  } catch (error) {
    // The same key sent twice at once: the second one finds the first one's lead.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const again = await findSiteLeadByKey(db, input.idempotencyKey);
      if (again) return { id: again.id, created: false };
    }
    throw error;
  }
}

/** Leads newest first, optionally one status only. */
export function listSiteLeads(db: Db, filter: { status?: SiteLeadStatus } = {}) {
  return db.siteLead.findMany({
    where: { status: filter.status },
    select,
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
}

/** Admin changes a lead's status and/or note; audited with before and after. */
export function updateSiteLead(
  db: Db,
  input: SiteLeadUpdateBody & { id: string; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const before = await tx.siteLead.findUnique({ where: { id: input.id } });
    if (!before) throw new DomainError('lead_not_found', 404);
    const data = {
      ...(input.status !== undefined && { status: input.status }),
      ...(input.note !== undefined && { note: input.note }),
    };
    const lead = await tx.siteLead.update({
      where: { id: input.id },
      data: { ...data, handledById: input.actorUserId },
      select,
    });
    // The lead is being followed up, so its alert is handled.
    if (lead.status !== 'new')
      await tx.alert.updateMany({
        where: { key: `site_lead:${lead.id}`, resolvedAt: null },
        data: { resolvedAt: new Date(), resolvedById: input.actorUserId },
      });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'site_lead.update',
      entityType: 'site_lead',
      entityId: lead.id,
      before: { status: before.status, note: before.note },
      after: { status: lead.status, note: lead.note },
    });
    return lead;
  });
}
