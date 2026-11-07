import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Role, Team } from '@shiply/shared';
import type { Request } from 'express';
import { DomainError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';

export const SESSION_COOKIE = 'shiply_session';

export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  role: Role;
  team: Team | null;
  hubId: string | null;
  merchantId: string | null;
  agentId: string | null;
}

const PUBLIC_KEY = 'public';
const ROLES_KEY = 'roles';
/** No sign in needed. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Only these roles may call the route. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): SessionUser => {
  return ctx.switchToHttp().getRequest<Request & { user: SessionUser }>().user;
});

/**
 * Runs on every route. Reads the signed session cookie, then loads the user fresh from the
 * database so a deactivated account or a changed role takes effect at once.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: SessionUser }>();
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (!token) throw new DomainError('unauthenticated', 'Please sign in', 401);
    let userId: string;
    try {
      userId = (await this.jwt.verifyAsync<{ sub: string }>(token)).sub;
    } catch {
      throw new DomainError('unauthenticated', 'Your session ended. Please sign in again', 401);
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.active) throw new DomainError('unauthenticated', 'Please sign in', 401);
    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      team: user.team,
      hubId: user.hubId,
      merchantId: user.merchantId,
      agentId: user.agentId,
    };

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles && !roles.includes(user.role)) throw new DomainError('forbidden', 'Your account cannot open this', 403);
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
  throw new DomainError('wrong_team', `This is the ${names[team]} team's station. You are in the ${names[user.team]} team`, 403);
}

/** Hub staff work only in their own hub. Admin can act in any hub. */
export function assertHubAccess(user: SessionUser, hubId: string) {
  if (user.role === 'ADMIN') return;
  if (user.role === 'HUB_STAFF' && user.hubId === hubId) return;
  throw new DomainError('forbidden', 'You can only work in your own hub', 403);
}
