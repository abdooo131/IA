import type { Prisma, PrismaClient } from '@prisma/client';

/** Either the full client or the client handed to a $transaction callback. */
export type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Runs `fn` in a transaction. When `db` is already a transaction client the work joins
 * that transaction, so callers can combine several stock changes with their own writes.
 */
export function inTransaction<T>(db: Db, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
  if ('$transaction' in db) return db.$transaction(fn);
  return fn(db);
}
