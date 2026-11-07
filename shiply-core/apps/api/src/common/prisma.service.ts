import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@shiply/db';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** Every state change runs in one serializable transaction, retried on write conflicts. */
  async tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 });
      } catch (e) {
        const retryable = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034';
        if (!retryable || attempt >= 3) throw e;
      }
    }
  }
}
