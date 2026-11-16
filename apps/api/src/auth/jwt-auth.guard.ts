import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ACCESS_TOKEN_COOKIE, type AccessTokenClaims, isRole } from '@shiplynow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { type AuthedRequest, IS_PUBLIC_KEY } from './decorators';

/**
 * Checks the access token and, once per request, that the account is still active: a disabled
 * user is refused at once (401) instead of working until the 15 minute token runs out.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = extractAccessToken(request);
    if (!token) throw new UnauthorizedException({ error: 'unauthenticated' });

    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(token);
      if (!claims.sub || !isRole(claims.role)) throw new Error('bad claims');
    } catch {
      throw new UnauthorizedException({ error: 'unauthenticated' });
    }
    if (!(await this.isActive(request, claims.sub)))
      throw new UnauthorizedException({ error: 'unauthenticated' });
    request.user = { sub: claims.sub, email: claims.email, role: claims.role };
    return true;
  }

  /** users.is_active, read once per request (kept on the request for any later check). */
  private async isActive(request: AuthedRequest, userId: string) {
    if (request.userActive === undefined) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { isActive: true },
      });
      request.userActive = user?.isActive === true;
    }
    return request.userActive;
  }
}

export function extractAccessToken(request: AuthedRequest): string | undefined {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const cookie: unknown = request.cookies?.[ACCESS_TOKEN_COOKIE];
  return typeof cookie === 'string' ? cookie : undefined;
}
