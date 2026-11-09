import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { from, mergeMap, of, type Observable } from 'rxjs';
import type { PrismaClient } from '@shiply/db';
import { DB } from '../tokens';

/**
 * A write sent again with the same Idempotency-Key by the same user answers what the first one
 * answered, and does nothing else.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(DB) private readonly db: PrismaClient) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const key = req.header('idempotency-key');
    if (req.method === 'GET' || !key || !req.user) return next.handle();
    const userId = req.user.id;
    const route = `${req.method} ${req.path}`;
    return from(this.db.idempotencyRecord.findUnique({ where: { key_userId: { key, userId } } })).pipe(
      mergeMap((found) => {
        if (found) {
          res.status(found.status);
          return of(found.body);
        }
        return next.handle().pipe(
          mergeMap((body) =>
            from(
              this.db.idempotencyRecord
                .create({ data: { key, userId, route, status: res.statusCode, body: (body ?? null) as never } })
                .catch(() => undefined)
                .then(() => body),
            ),
          ),
        );
      }),
    );
  }
}
