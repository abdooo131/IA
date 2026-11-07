// Sign in for the parcel network, on top of Shiply Now's. Shiply Now's guard has already checked
// the access token; this one loads the person fresh from the database and gives the parcel code
// the same SessionUser it always had. Shiply Now's roles map to the network's: admin and finance
// are ADMIN here, and store staff and riders cannot open network routes.
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ACCESS_TOKEN_COOKIE } from '@shiplynow/shared';
import type { Role, Team } from '@shiplynow/shared/parcels';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../auth/decorators';
import { DomainError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';

export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  role: Role;
  team: Team | null;
  hubId: string | null;
  merchantId: string | null;
  agentId: string | null;
  merchantOwner: boolean;
  merchantRights: string[];
}

const ROLES_KEY = 'parcels:roles';
/** No sign in needed. The same mark Shiply Now's guard reads. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
/** Only these network roles may call the route. With no roles, any signed in network user. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

type ParcelRequest = Request & { parcelUser?: SessionUser; user?: { sub: string } };

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): SessionUser => {
    return ctx.switchToHttp().getRequest<ParcelRequest>().parcelUser!;
  },
);

/** Shiply Now's role, as the network knows it. */
export function networkRole(role: string): Role | null {
  switch (role) {
    case 'admin':
    case 'finance':
      return 'ADMIN';
    case 'merchant':
      return 'MERCHANT';
    case 'hub_staff':
      return 'HUB_STAFF';
    case 'courier':
      return 'COURIER';
    case 'agent':
      return 'AGENT';
    default:
      return null;
  }
}

/** The database role for a network role, when the network makes an account. */
export function dbRole(role: Role) {
  return (
    {
      ADMIN: 'admin',
      MERCHANT: 'merchant',
      HUB_STAFF: 'hub_staff',
      COURIER: 'courier',
      AGENT: 'agent',
    } as const
  )[role];
}

/** Runs on every request; acts only on network routes (those marked with @Roles). */
@Injectable()
export class ParcelsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles === undefined) return true; // not a network route
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<ParcelRequest>();
    let userId = req.user?.sub;
    if (!userId) {
      const header = req.headers.authorization;
      const token = header?.startsWith('Bearer ')
        ? header.slice(7)
        : (req.cookies as Record<string, string> | undefined)?.[ACCESS_TOKEN_COOKIE];
      if (!token) throw new DomainError('unauthenticated', 'Please sign in', 401);
      try {
        userId = (await this.jwt.verifyAsync<{ sub: string }>(token)).sub;
      } catch {
        throw new DomainError('unauthenticated', 'Your session ended. Please sign in again', 401);
      }
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw new DomainError('unauthenticated', 'Please sign in', 401);
    const role = networkRole(user.role);
    if (!role) throw new DomainError('forbidden', 'Your account cannot open this', 403);
    req.parcelUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role,
      team: user.team,
      hubId: user.hubId,
      merchantId: user.merchantId,
      agentId: user.agentId,
      merchantOwner: user.role === 'merchant' && user.merchantRole !== 'member',
      merchantRights: user.merchantRights,
    };
    if (roles.length && !roles.includes(role))
      throw new DomainError('forbidden', 'Your account cannot open this', 403);
    return true;
  }
}

/**
 * Inside a sorting facility each station belongs to one team. Staff with no team (supervisors)
 * and admins can work every station. Last mile hubs have no teams.
 */
export function assertTeam(user: SessionUser, hub: { isSorting: boolean }, team: Team) {
  if (!hub.isSorting || user.role === 'ADMIN' || !user.team || user.team === team) return;
  const names = { INBOUND: 'inbound', SORTING: 'sorting', OUTBOUND: 'outbound' } as const;
  throw new DomainError(
    'wrong_team',
    `This is the ${names[team]} team's station. You are in the ${names[user.team]} team`,
    403,
  );
}

/** Hub staff work only in their own hub. Admin can act in any hub. */
export function assertHubAccess(user: SessionUser, hubId: string) {
  if (user.role === 'ADMIN') return;
  if (user.role === 'HUB_STAFF' && user.hubId === hubId) return;
  throw new DomainError('forbidden', 'You can only work in your own hub', 403);
}

/** Merchant team members work only where they have the right; the owner has every right. */
export function assertMerchantRight(
  user: SessionUser,
  right: 'orders' | 'pickups' | 'money' | 'settings',
) {
  if (user.role !== 'MERCHANT' || user.merchantOwner || user.merchantRights.includes(right)) return;
  throw new DomainError('forbidden', 'Your account cannot open this. Ask the account owner', 403);
}
