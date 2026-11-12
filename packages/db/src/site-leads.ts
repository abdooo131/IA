import { Prisma } from '@prisma/client';
import { normalizeEgyptianPhone, latinDigits, type SiteLeadBody } from '@shiplynow/shared';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { leadFromSiteForm } from './crm';

// Leads from the public website's contact form (docs/ARCHITECTURE.md, Public website).
//
//   form ──▶ site_leads (what the visitor sent, kept as is)
//              └──▶ Sales CRM: company + contact + deal at stage new (docs/SALES.md)
//
// The follow up (who calls, the stage, notes) lives in the CRM. Each submission carries the
// form's idempotency key, so a double tap or a retry makes one lead, one deal and one
// site_lead alert.

/** The lead a submission with this key already made, if any. */
export function findSiteLeadByKey(db: Db, idempotencyKey: string) {
  return db.siteLead.findUnique({ where: { idempotencyKey }, select: { id: true } });
}

/**
 * Stores a lead, opens its CRM company and deal and raises one site_lead alert, in one
 * transaction. A valid Egyptian mobile is kept as +20 and 10 digits; anything else is kept as
 * typed and flagged.
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
      const crm = await leadFromSiteForm(tx, lead);
      await tx.alert.create({
        data: {
          type: 'site_lead',
          key: `site_lead:${lead.id}`,
          data: {
            leadId: lead.id,
            dealId: crm.dealId,
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
          dealId: crm.dealId,
        },
      });
      return { id: lead.id, created: true, dealId: crm.dealId };
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
