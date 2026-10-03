import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { RequestContext } from '../common/context';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Runs fn inside one transaction with the row level security context set for the caller.
   * Merchant users only ever see rows of their own merchant_id; staff get the bypass flag.
   */
  async withContext<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>, opts?: { timeout?: number }): Promise<T> {
    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.merchant_id', ${ctx.merchantId ?? ''}, true),
                                    set_config('app.bypass_rls', ${ctx.bypassRls ? 'on' : 'off'}, true)`;
        return fn(tx);
      },
      { timeout: opts?.timeout ?? 15000, maxWait: 10000 },
    );
  }

  /** System context for jobs, seeds and authentication lookups. */
  async asSystem<T>(fn: (tx: Tx) => Promise<T>, opts?: { timeout?: number }): Promise<T> {
    return this.withContext(SYSTEM_CONTEXT, fn, opts);
  }
}

export const SYSTEM_CONTEXT: RequestContext = {
  userId: null,
  role: 'SYSTEM',
  merchantId: null,
  franchiseId: null,
  bypassRls: true,
  language: 'en',
};
