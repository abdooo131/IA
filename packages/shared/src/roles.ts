/**
 * Account roles. The first five are Shiply Now's; hub_staff, courier and agent belong to the
 * Shiply parcel network (sorting facilities and hubs, couriers, delivery agents).
 */
export const ROLES = [
  'admin',
  'merchant',
  'store_staff',
  'rider',
  'finance',
  'hub_staff',
  'courier',
  'agent',
] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
