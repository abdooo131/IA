import { CallHandler, ExecutionContext, HttpException, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { catchError, from, mergeMap, of, type Observable } from 'rxjs';
import { Prisma, type PrismaClient } from '@shiply/db';
import { DB } from '../tokens';

/**
 * A write sent again with the same Idempotency-Key by the same user answers what the first one
 * answered, and does nothing else. The key is claimed before the work runs, so copies that arrive
 * at the same moment wait their turn (409) instead of running twice.
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
    const where = { key_userId: { key, userId } };
    return from(
      this.db.idempotencyRecord.createMany({ data: [{ key, userId, route, status: 0, body: Prisma.JsonNull }], skipDuplicates: true }),
    ).pipe(
      mergeMap(async ({ count }) => {
        if (count === 1) return null;
        const found = await this.db.idempotencyRecord.findUnique({ where });
        if (!found) throw new HttpException({ error: 'in_progress' }, 409);
        if (found.route !== route) throw new HttpException({ error: 'idempotency_key_reused' }, 422);
        if (found.status === 0) throw new HttpException({ error: 'in_progress' }, 409);
        return found;
      }),
      mergeMap((found) => {
        if (found) {
          res.status(found.status);
          return of(found.body);
        }
        return next.handle().pipe(
          mergeMap(async (body) => {
            await this.db.idempotencyRecord.update({ where, data: { status: res.statusCode, body: body === undefined || body === null ? Prisma.JsonNull : (body as never) } });
            return body;
          }),
          catchError(async (err) => {
            // The work failed: free the key so the same request can be tried again.
            await this.db.idempotencyRecord.delete({ where }).catch(() => undefined);
            throw err;
          }),
        );
      }),
    );
  }
}
