import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@shiply/shared';
import type { Request } from 'express';
import { DomainError } from '../common/errors';
import { PrismaService } from '../common/prisma.service';

export const SESSION_COOKIE = 'shiply_session';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  hubId: string | null;
  merchantId: string | null;
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
      hubId: user.hubId,
      merchantId: user.merchantId,
    };

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles && !roles.includes(user.role)) throw new DomainError('forbidden', 'Your account cannot open this', 403);
    return true;
  }
}

/** Hub staff work only in their own hub. Admin can act in any hub. */
export function assertHubAccess(user: SessionUser, hubId: string) {
  if (user.role === 'ADMIN') return;
  if (user.role === 'HUB_STAFF' && user.hubId === hubId) return;
  throw new DomainError('forbidden', 'You can only work in your own hub', 403);
}
