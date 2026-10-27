import type { LedgerAccountType, Prisma } from '@prisma/client';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';

type Tx = Prisma.TransactionClient;

/** Where money sits. Company accounts have no owner; wallets belong to one party. */
export type AccountRef =
  | { type: 'merchant'; merchantId: string }
  | { type: 'rider_cash'; riderId: string }
  | { type: 'rider_bonus'; riderId: string }
  | { type: 'store_cash'; darkStoreId: string }
  | {
      type:
        | 'bank'
        | 'revenue'
        | 'vat_payable'
        | 'rider_bonus_expense'
        | 'cash_difference'
        | 'damage_expense';
    };

export function accountKey(ref: AccountRef): string {
  switch (ref.type) {
    case 'merchant':
      return `merchant:${ref.merchantId}`;
    case 'rider_cash':
      return `rider_cash:${ref.riderId}`;
    case 'rider_bonus':
      return `rider_bonus:${ref.riderId}`;
    case 'store_cash':
      return `store_cash:${ref.darkStoreId}`;
    default:
      return ref.type;
  }
}

async function accountId(tx: Tx, ref: AccountRef): Promise<string> {
  const key = accountKey(ref);
  const found = await tx.ledgerAccount.findUnique({ where: { key } });
  if (found) return found.id;
  const created = await tx.ledgerAccount.upsert({
    where: { key },
    update: {},
    create: {
      key,
      type: ref.type as LedgerAccountType,
      merchantId: 'merchantId' in ref ? ref.merchantId : null,
      riderId: 'riderId' in ref ? ref.riderId : null,
      darkStoreId: 'darkStoreId' in ref ? ref.darkStoreId : null,
    },
  });
  return created.id;
}

export interface PostInput {
  kind: string;
  idempotencyKey: string;
  occurredAt?: Date;
  memo?: string;
  orderId?: string | null;
  data?: Prisma.InputJsonValue;
  createdById?: string | null;
  /** Debit positive, credit negative. Lines of zero are dropped. */
  lines: { account: AccountRef; amount: number }[];
}

/**
 * Posts one balanced entry. The same idempotency key posts once: a repeat returns the
 * first entry, so jobs and retries are safe. Returns null when every line is zero.
 */
export async function post(db: Db, input: PostInput) {
  const lines = input.lines.filter((l) => l.amount !== 0);
  for (const l of lines)
    if (!Number.isSafeInteger(l.amount)) throw new DomainError('amount_not_integer', 400);
  if (lines.length === 0) return null;
  const total = lines.reduce((s, l) => s + l.amount, 0);
  if (total !== 0 || lines.length < 2) throw new Error(`unbalanced ledger entry ${input.kind}`);

  return inTransaction(db, async (tx) => {
    const seen = await tx.ledgerEntry.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (seen) return seen;
    const occurredAt = input.occurredAt ?? new Date();
    const entry = await tx.ledgerEntry.create({
      data: {
        kind: input.kind,
        idempotencyKey: input.idempotencyKey,
        occurredAt,
        memo: input.memo,
        orderId: input.orderId ?? null,
        data: input.data,
        createdById: input.createdById ?? null,
      },
    });
    for (const line of lines) {
      await tx.ledgerLine.create({
        data: {
          entryId: entry.id,
          accountId: await accountId(tx, line.account),
          amountPiastres: line.amount,
          occurredAt,
        },
      });
    }
    return entry;
  });
}

/** Debit minus credit of one account, optionally up to (not including) a moment. */
export async function balanceOf(db: Db, ref: AccountRef, before?: Date): Promise<number> {
  const result = await db.ledgerLine.aggregate({
    where: { account: { key: accountKey(ref) }, occurredAt: before ? { lt: before } : undefined },
    _sum: { amountPiastres: true },
  });
  return result._sum.amountPiastres ?? 0;
}

/** Balances of every account of the given types, keyed by account key. */
export async function balancesByType(db: Db, types: LedgerAccountType[]) {
  const accounts = await db.ledgerAccount.findMany({ where: { type: { in: types } } });
  const sums = await db.ledgerLine.groupBy({
    by: ['accountId'],
    where: { accountId: { in: accounts.map((a) => a.id) } },
    _sum: { amountPiastres: true },
  });
  return accounts.map((a) => ({
    ...a,
    balance: sums.find((s) => s.accountId === a.id)?._sum.amountPiastres ?? 0,
  }));
}

/** A share in basis points of an amount, rounded half up, in whole piastres. */
export function share(amount: number, basisPoints: number): number {
  return Math.floor((amount * basisPoints + 5_000) / 10_000);
}
