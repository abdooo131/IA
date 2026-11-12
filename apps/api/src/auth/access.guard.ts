import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getAccessProfile, getMerchantAccess } from '@shiplynow/db';
import {
  type AccessProfile,
  canDo,
  canUseMerchant,
  canUseStore,
  isTeamRole,
  type MerchantRightName,
  NO_ACCESS,
  type Role,
} from '@shiplynow/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  ACCESS_KEY,
  type AccessRule,
  type AuthedRequest,
  MERCHANT_RIGHT_KEY,
  ROLES_KEY,
} from './decorators';

/**
 * Checks @Access for team members (admin, finance and store staff accounts) against their
 * access profile, read fresh once per request so a change applies at once (docs/ACCESS.md),
 * and @MerchantRight for merchant members. Refusals answer 403 { error: 'no_access' } or,
 * for a store outside the person's stores, { error: 'store_not_allowed' }.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const rule = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_KEY, targets);
    const right = this.reflector.getAllAndOverride<MerchantRightName | 'owner' | undefined>(
      MERCHANT_RIGHT_KEY,
      targets,
    );
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = req.user;
    if (!user) return true; // public route: the JWT guard let it through on purpose

    if (rule) {
      if (!isTeamRole(user.role)) {
        // Riders (tickets, photos) pass only where @Roles names them.
        const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
        if (!roles?.includes(user.role)) throw new ForbiddenException({ error: 'forbidden' });
      } else {
        const profile = await loadAccess(req, this.prisma);
        const level =
          rule.level ?? (req.method === 'GET' || req.method === 'HEAD' ? 'view' : 'use');
        if (!rule.apps.some((app) => canDo(profile, app, level)))
          throw new ForbiddenException({ error: 'no_access' });
        if (rule.also?.some(([app, needed]) => !canDo(profile, app, needed)))
          throw new ForbiddenException({ error: 'no_access' });
        if (rule.customerData && !profile.customerData)
          throw new ForbiddenException({ error: 'no_access' });
        if (rule.salaries && !profile.salaries)
          throw new ForbiddenException({ error: 'no_access' });
        for (const storeId of requestedStores(req, rule.storeParam))
          if (!canUseStore(profile, storeId))
            throw new ForbiddenException({ error: 'store_not_allowed' });
        for (const merchantId of requestedMerchants(req, rule.merchantParam))
          if (!canUseMerchant(profile, merchantId))
            throw new ForbiddenException({ error: 'merchant_not_allowed' });
      }
    }

    if (right && user.role === 'merchant') {
      const me = await getMerchantAccess(this.prisma, user.sub);
      const allowed =
        me && (right === 'owner' ? me.merchantRole === 'owner' : me.rights.includes(right));
      if (!allowed) throw new ForbiddenException({ error: 'no_access' });
    }
    return true;
  }
}

/** The caller's profile, read once per request (a team member without one gets nothing). */
export async function loadAccess(
  req: AuthedRequest,
  prisma: PrismaService,
): Promise<AccessProfile> {
  if (req.access) return req.access;
  const profile = (req.user ? await getAccessProfile(prisma, req.user.sub) : null) ?? NO_ACCESS;
  req.access = profile;
  return profile;
}

/** Store ids a request names: the :storeId parameter (or the rule's), and ?darkStoreId. */
function requestedStores(req: AuthedRequest, storeParam?: string): string[] {
  const params = req.params as Record<string, string | undefined>;
  const query = req.query as Record<string, unknown>;
  const ids = [params.storeId, storeParam ? params[storeParam] : undefined, query.darkStoreId];
  return ids.filter((id): id is string => typeof id === 'string' && id !== '');
}

/** Merchant ids a request names: :merchantId (or the rule's parameter) and ?merchantId. */
function requestedMerchants(req: AuthedRequest, merchantParam?: string): string[] {
  const params = req.params as Record<string, string | undefined>;
  const query = req.query as Record<string, unknown>;
  const ids = [
    params.merchantId,
    merchantParam ? params[merchantParam] : undefined,
    query.merchantId,
  ];
  return ids.filter((id): id is string => typeof id === 'string' && id !== '');
}
