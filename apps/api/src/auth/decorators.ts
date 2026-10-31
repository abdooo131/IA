import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AccessTokenClaims, Role } from '@shiplynow/shared';
import type { Request } from 'express';

export const IS_PUBLIC_KEY = 'isPublic';
/** Skips the global JWT guard for this route. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
/** Restricts a route to the given roles. Without it any signed in user may call the route. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export type AuthedRequest = Request & { user?: AccessTokenClaims };

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessTokenClaims | undefined =>
    ctx.switchToHttp().getRequest<AuthedRequest>().user,
);
