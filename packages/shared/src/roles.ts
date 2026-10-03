export const ROLES = [
  'SUPER_ADMIN',
  'OPERATIONS_MANAGER',
  'DRIVER_MANAGER',
  'DISPATCH',
  'FINANCE',
  'QC_AGENT',
  'HUB_STAFF',
  'FRANCHISE_MANAGER',
  'MERCHANT_OWNER',
  'MERCHANT_TEAM_MEMBER',
  'PICKUP_DRIVER',
  'DELIVERY_DRIVER',
] as const;
export type Role = (typeof ROLES)[number];

export const MERCHANT_ROLES: readonly Role[] = ['MERCHANT_OWNER', 'MERCHANT_TEAM_MEMBER'];
export const DRIVER_ROLES: readonly Role[] = ['PICKUP_DRIVER', 'DELIVERY_DRIVER'];
export const STAFF_ROLES: readonly Role[] = ROLES.filter(
  (r) => !MERCHANT_ROLES.includes(r) && !DRIVER_ROLES.includes(r),
);

export function isMerchantRole(role: Role): boolean {
  return MERCHANT_ROLES.includes(role);
}

export function isStaffRole(role: Role): boolean {
  return STAFF_ROLES.includes(role);
}

export const LANGUAGES = ['en', 'ar'] as const;
export type Language = (typeof LANGUAGES)[number];
