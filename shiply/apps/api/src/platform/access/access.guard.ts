import { CanActivate, ExecutionContext, HttpException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { atLeast, type AppId, type Level } from '@shiply/shared';
import { NEED_ACCESS } from './need-access.decorator';

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const need = this.reflector.getAllAndOverride<{ app: AppId; level: Level } | undefined>(NEED_ACCESS, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!need) return true;
    const user = ctx.switchToHttp().getRequest<Request>().user;
    if (user && atLeast(user.access[need.app], need.level)) return true;
    throw new HttpException({ error: 'no_access', app: need.app, need: need.level }, 403);
  }
}
