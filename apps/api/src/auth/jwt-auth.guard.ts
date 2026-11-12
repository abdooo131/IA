import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ACCESS_TOKEN_COOKIE, type AccessTokenClaims, isRole } from '@shiplynow/shared';
import { type AuthedRequest, IS_PUBLIC_KEY } from './decorators';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
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

    try {
      const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token);
      if (!claims.sub || !isRole(claims.role)) throw new Error('bad claims');
      request.user = { sub: claims.sub, email: claims.email, role: claims.role };
      return true;
    } catch {
      throw new UnauthorizedException({ error: 'unauthenticated' });
    }
  }
}

function extractAccessToken(request: AuthedRequest): string | undefined {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const cookie: unknown = request.cookies?.[ACCESS_TOKEN_COOKIE];
  return typeof cookie === 'string' ? cookie : undefined;
}
