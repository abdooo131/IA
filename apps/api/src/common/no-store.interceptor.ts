import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';

/** Financial endpoints are never cached (spec 13). */
@Injectable()
export class NoStoreInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler) {
    ctx.switchToHttp().getResponse().setHeader('Cache-Control', 'no-store');
    return next.handle();
  }
}
