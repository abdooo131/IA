import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@shiply/shared';
import type { RequestContext } from './context';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const Ctx = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestContext => {
  return ctx.switchToHttp().getRequest().ctx;
});
