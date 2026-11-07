import { ForbiddenException } from '@nestjs/common';
import { type AccessProfile, canUseMerchant, canUseStore } from '@shiplynow/shared';

// Store scope (docs/ACCESS.md): a team member without all_stores sees only their listed
// stores in every app. Lists are filtered with these helpers; single records are refused.

/** The stores a person is limited to, or null for every store (riders and merchants: null). */
export function limitedStores(access: AccessProfile | undefined): string[] | null {
  if (!access || access.allStores) return null;
  return access.storeIds;
}

/**
 * A Prisma filter on dark_store_id: the requested store (the guard already checked it), else
 * the person's stores when they are limited, else nothing.
 */
export function storeFilter(
  access: AccessProfile | undefined,
  requested?: string | null,
): string | { in: string[] } | undefined {
  if (requested) return requested;
  const stores = limitedStores(access);
  return stores ? { in: stores } : undefined;
}

/** Refuses a record of a store outside the person's stores (null store: company wide). */
export function assertStore(access: AccessProfile | undefined, darkStoreId: string | null) {
  if (!access || access.allStores) return;
  if (!darkStoreId || !canUseStore(access, darkStoreId))
    throw new ForbiddenException({ error: 'store_not_allowed' });
}

// Account managers (docs/HR.md 5): a person with own_merchants_only sees only the merchants
// whose account manager they are, in every app.

/** The merchants a person is limited to, or null for every merchant. */
export function limitedMerchants(access: AccessProfile | undefined): string[] | null {
  if (!access || !access.ownMerchantsOnly) return null;
  return access.merchantIds;
}

/** A Prisma filter on merchant_id: the requested merchant (checked), else theirs, else nothing. */
export function merchantFilter(
  access: AccessProfile | undefined,
  requested?: string | null,
): string | { in: string[] } | undefined {
  if (requested) {
    assertMerchant(access, requested);
    return requested;
  }
  const merchants = limitedMerchants(access);
  return merchants ? { in: merchants } : undefined;
}

/** Refuses a record of a merchant the person does not look after. */
export function assertMerchant(access: AccessProfile | undefined, merchantId: string | null) {
  if (!access || !access.ownMerchantsOnly) return;
  if (!merchantId || !canUseMerchant(access, merchantId))
    throw new ForbiddenException({ error: 'merchant_not_allowed' });
}
