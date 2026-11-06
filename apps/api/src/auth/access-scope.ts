import { ForbiddenException } from '@nestjs/common';
import { type AccessProfile, canUseStore } from '@shiplynow/shared';

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
