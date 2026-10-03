import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '@shiply/shared';
import { contextFromToken, JwtPayload } from './context';
import { IS_PUBLIC, ROLES_KEY } from './decorators';

/** Global guard: verifies the bearer token, builds req.ctx, then enforces @Roles. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Missing token');
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(token, { secret: process.env.JWT_ACCESS_SECRET });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    req.ctx = contextFromToken(payload, req.ip);
    req.tokenApp = payload.app;

    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, targets);
    if (roles && roles.length && !roles.includes(payload.role)) {
      throw new ForbiddenException('Role not allowed');
    }
    return true;
  }
}
