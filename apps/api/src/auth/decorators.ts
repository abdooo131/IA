import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import {
  ACCESS_APPS,
  type AccessApp,
  type AccessLevel,
  type AccessProfile,
  type AccessTokenClaims,
  type MerchantRightName,
  type Role,
} from '@shiplynow/shared';
import type { Request } from 'express';

export const IS_PUBLIC_KEY = 'isPublic';
/** Skips the global JWT guard for this route. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
/** Restricts a route to the given roles. Without it any signed in user may call the route. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const ACCESS_KEY = 'access';
/** Any app: shared lookups (stores, merchants, settings) every team member's pages read. */
export const ANY_APP = ACCESS_APPS;
export interface AccessRule {
  /** The app (or any of the apps) the route belongs to */
  apps: readonly AccessApp[];
  /** Needed level; without it GET and HEAD need view and other methods use */
  level?: AccessLevel;
  /** Named customer profiles also need customer_data */
  customerData?: boolean;
  /** Salaries, payslips and the payroll run also need salaries */
  salaries?: boolean;
  /** A route parameter holding a dark store id other than :storeId, checked against the stores */
  storeParam?: string;
  /** A route parameter holding a merchant id other than :merchantId, checked for account managers */
  merchantParam?: string;
  /** Further levels needed as well, for example settings manage on owner only routes */
  also?: readonly (readonly [AccessApp, AccessLevel])[];
}

/**
 * Restricts a route to team members (admin, finance and store staff accounts) whose access
 * profile reaches `level` in `app` (docs/ACCESS.md). The method level overrides the class
 * level. Riders and merchants are refused unless the route's @Roles names them.
 */
export const Access = (
  app: AccessApp | readonly AccessApp[],
  level?: AccessLevel,
  options: Omit<AccessRule, 'apps' | 'level'> = {},
) =>
  SetMetadata(ACCESS_KEY, {
    apps: typeof app === 'string' ? [app] : app,
    level,
    ...options,
  } satisfies AccessRule);

export const MERCHANT_RIGHT_KEY = 'merchantRight';
/** A merchant member needs this right (owners have all); 'owner' limits the route to owners. */
export const MerchantRight = (right: MerchantRightName | 'owner') =>
  SetMetadata(MERCHANT_RIGHT_KEY, right);

export type AuthedRequest = Request & { user?: AccessTokenClaims; access?: AccessProfile };

/** The caller's access profile, loaded by the AccessGuard for routes marked @Access. */
export const CurrentAccess = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessProfile | undefined =>
    ctx.switchToHttp().getRequest<AuthedRequest>().access,
);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessTokenClaims | undefined =>
    ctx.switchToHttp().getRequest<AuthedRequest>().user,
);
