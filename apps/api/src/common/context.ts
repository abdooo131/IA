import type { Role } from '@shiply/shared';
import { isMerchantRole, isStaffRole } from '@shiply/shared';

export interface RequestContext {
  userId: string | null;
  role: Role | 'SYSTEM';
  merchantId: string | null;
  franchiseId: string | null;
  bypassRls: boolean;
  language: 'en' | 'ar';
  ip?: string;
}

export interface JwtPayload {
  sub: string;
  role: Role;
  mid: string | null;
  fid: string | null;
  lang: 'en' | 'ar';
  app: AppName;
}

export const APPS = ['merchant', 'ops', 'pickup', 'delivery'] as const;
export type AppName = (typeof APPS)[number];

/**
 * Builds the database context from a verified token. Only company staff bypass merchant isolation.
 * Franchise managers and drivers get no bypass; their scoped policies arrive with their phases.
 */
export function contextFromToken(p: JwtPayload, ip?: string): RequestContext {
  const merchant = isMerchantRole(p.role);
  return {
    userId: p.sub,
    role: p.role,
    merchantId: merchant ? p.mid : null,
    franchiseId: p.fid,
    bypassRls: isStaffRole(p.role) && p.role !== 'FRANCHISE_MANAGER',
    language: p.lang,
    ip,
  };
}
