import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';
import { mapUnique } from './admin-ops';
import { notifyMerchant } from './notifications';
import { hashPassword } from './password';

// Merchant self sign up: the applicant gets a merchant (inactive, approval pending) and a
// merchant user who cannot sign in until admin approves. Admin sees an alert for each one.
//
//   sign up ──▶ pending ──approve──▶ approved (merchant and its users active)
//                  └─────reject───▶ rejected (stays inactive, reason kept)

export interface SignUpInput {
  businessName: string;
  contactName: string;
  email: string;
  /** Normalized Egyptian mobile, +20 and 10 digits */
  phone: string;
  password: string;
  shopDomain?: string;
}

export function signUpMerchant(db: Db, input: SignUpInput) {
  return mapUnique(async () => {
    const passwordHash = await hashPassword(input.password);
    return inTransaction(db, async (tx) => {
      const merchant = await tx.merchant.create({
        data: {
          name: input.businessName,
          contactEmail: input.email,
          contactPhone: input.phone,
          isActive: false,
          approval: 'pending',
        },
      });
      const user = await tx.user.create({
        data: {
          email: input.email,
          name: input.contactName,
          phone: input.phone,
          role: 'merchant',
          passwordHash,
          isActive: false,
          merchantId: merchant.id,
        },
      });
      await tx.alert.create({
        data: {
          type: 'merchant_signup',
          data: {
            merchantId: merchant.id,
            name: merchant.name,
            shopDomain: input.shopDomain ?? null,
          },
        },
      });
      await recordAudit(tx, {
        actorUserId: null,
        action: 'merchant.sign_up',
        entityType: 'merchant',
        entityId: merchant.id,
        after: {
          name: merchant.name,
          email: input.email,
          phone: input.phone,
          shopDomain: input.shopDomain ?? null,
          userId: user.id,
        },
      });
      return { merchantId: merchant.id };
    });
  });
}

/** Admin approves or rejects a pending sign up. Approval opens the merchant and its users. */
export function decideSignUp(
  db: Db,
  input: { merchantId: string; approve: boolean; reason?: string; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const merchant = await tx.merchant.findUnique({ where: { id: input.merchantId } });
    if (!merchant) throw new DomainError('merchant_not_found', 404);
    if (merchant.approval !== 'pending') throw new DomainError('not_pending');
    if (!input.approve && !input.reason?.trim()) throw new DomainError('reason_required', 400);
    const approval = input.approve ? 'approved' : 'rejected';
    await tx.merchant.update({
      where: { id: merchant.id },
      data: {
        approval,
        isActive: input.approve,
        rejectReason: input.approve ? null : input.reason!.trim(),
      },
    });
    if (input.approve) {
      await tx.user.updateMany({ where: { merchantId: merchant.id }, data: { isActive: true } });
      await notifyMerchant(tx, merchant.id, 'account_approved', { name: merchant.name });
    }
    await tx.alert.updateMany({
      where: {
        type: 'merchant_signup',
        resolvedAt: null,
        data: { path: ['merchantId'], equals: merchant.id },
      },
      data: { resolvedAt: new Date(), resolvedById: input.actorUserId },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: input.approve ? 'merchant.approve' : 'merchant.reject',
      entityType: 'merchant',
      entityId: merchant.id,
      before: { approval: 'pending' },
      after: { approval, reason: input.reason ?? null },
    });
    return { approval };
  });
}

/** What a new merchant still has to do before the first 60 minute order. */
export async function onboardingSteps(db: Db, merchantId: string) {
  const [merchant, skus, manifests, shop] = await Promise.all([
    db.merchant.findUniqueOrThrow({ where: { id: merchantId } }),
    db.sku.count({ where: { merchantId } }),
    db.inboundManifest.count({ where: { merchantId, status: { not: 'cancelled' } } }),
    db.shopifyShop.findUnique({ where: { merchantId } }),
  ]);
  return {
    products: skus > 0,
    price: merchant.expressPricePiastres !== null,
    shopify: shop?.status === 'active',
    shipment: manifests > 0,
  };
}
