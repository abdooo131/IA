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

/**
 * Refuses a record (recordRef) outside the person's stores and merchants: its store, or for a
 * record of several locations (a transfer) one of them, and its merchant.
 */
export function assertRecordScope(
  access: AccessProfile | undefined,
  ref: {
    darkStoreId: string | null;
    merchantId: string | null;
    anyStoreIds?: string[];
    ownerIds?: string[];
  },
  userId?: string,
) {
  if (ref.darkStoreId) assertStore(access, ref.darkStoreId);
  if (ref.anyStoreIds) assertAnyStore(access, ref.anyStoreIds);
  if (ref.merchantId) assertMerchant(access, ref.merchantId);
  if (ref.ownerIds) assertOwnDeals(access, ref.ownerIds, userId);
}

/**
 * Sales reps with own_deals_only (never sales managers) reach only the records they own
 * (CLAUDE.md "Sales CRM part 1"): any other answers deal_not_allowed, as the CRM's routes do.
 */
export function assertOwnDeals(
  access: AccessProfile | undefined,
  ownerIds: string[],
  userId: string | undefined,
) {
  if (!access || !access.ownDealsOnly || access.sales === 'manage') return;
  if (!userId || !ownerIds.includes(userId))
    throw new ForbiddenException({ error: 'deal_not_allowed' });
}

/** Refuses a record none of whose locations is one of the person's stores. */
export function assertAnyStore(access: AccessProfile | undefined, storeIds: string[]) {
  if (!access || access.allStores) return;
  if (!storeIds.some((id) => canUseStore(access, id)))
    throw new ForbiddenException({ error: 'store_not_allowed' });
}
