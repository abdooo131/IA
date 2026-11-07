export const ROLES = ['admin', 'merchant', 'store_staff', 'rider', 'finance'] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
