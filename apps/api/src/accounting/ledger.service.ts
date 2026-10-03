import { Injectable } from '@nestjs/common';
import { JournalType, Prisma } from '@prisma/client';
import { Tx } from '../prisma/prisma.service';
import { ACC, failedFeeAmounts, Line } from './posting';

export interface PostInput {
  type: JournalType;
  description: string;
  idempotencyKey: string;
  lines: Line[];
  merchantId?: string | null;
  orderId?: string | null;
  referenceType?: string;
  referenceId?: string;
  occurredAt?: Date;
  createdById?: string | null;
  reversesId?: bigint;
}

/**
 * The only way money enters the ledger. One journal per call, inside the caller's transaction.
 * Posting twice with the same idempotency key returns the first journal instead of double counting.
 * The database independently enforces balance, one sided lines and append only rows.
 */
@Injectable()
export class LedgerService {
  async post(tx: Tx, input: PostInput) {
    const existing = await tx.journalEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return { journal: existing, created: false };
    const occurredAt = input.occurredAt ?? new Date();
    const journal = await tx.journalEntry.create({
      data: {
        type: input.type,
        description: input.description,
        idempotencyKey: input.idempotencyKey,
        merchantId: input.merchantId ?? null,
        orderId: input.orderId ?? null,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        occurredAt,
        createdById: input.createdById ?? null,
        reversesId: input.reversesId ?? null,
      },
    });
    await tx.ledgerEntry.createMany({
      data: input.lines.map((l) => ({
        journalId: journal.id,
        accountCode: l.account,
        merchantId: l.merchantId ?? null,
        orderId: l.orderId ?? null,
        driverId: l.driverId ?? null,
        debit: l.debit ?? 0,
        credit: l.credit ?? 0,
        memo: l.memo ?? null,
        occurredAt,
      })),
    });
    return { journal, created: true };
  }

  /** Merchant wallet balance = credits minus debits on 2010 for that merchant. Always derived, never stored. */
  async merchantBalance(tx: Tx, merchantId: string): Promise<number> {
    const r = await tx.ledgerEntry.aggregate({
      where: { accountCode: ACC.MERCHANT_WALLETS, merchantId },
      _sum: { debit: true, credit: true },
    });
    return (r._sum.credit ?? 0) - (r._sum.debit ?? 0);
  }

  async pendingCashouts(tx: Tx, merchantId: string): Promise<number> {
    const r = await tx.cashoutRequest.aggregate({ where: { merchantId, status: 'PENDING' }, _sum: { amount: true } });
    return r._sum.amount ?? 0;
  }

  /** Net amount that tonight's cash cycle will add to (or take from) the wallet. */
  async pendingSettlement(tx: Tx, merchantId: string): Promise<{ amount: number; orders: number }> {
    const orders = await tx.order.findMany({
      where: { merchantId, settledAt: null, status: { in: ['DELIVERED', 'RETURNED', 'UNSUCCESSFUL'] } },
      select: {
        id: true, merchantId: true, trackingNumber: true, status: true, codAmount: true, shippingFee: true, codFee: true,
        openPackageFee: true, vatAmount: true, totalFees: true, failedDeliveryFee: true, pricingSnapshot: true,
      },
    });
    let amount = 0;
    for (const o of orders) {
      if (o.status === 'DELIVERED') amount += o.codAmount - o.totalFees;
      else {
        const { fee, vat } = failedFeeAmounts(o);
        amount -= fee + vat;
      }
    }
    return { amount, orders: orders.length };
  }

  /** Balance of every account as of a point in time, in its natural sign (assets/expenses debit positive). */
  async accountBalances(tx: Tx, asOf?: Date, from?: Date) {
    const where: Prisma.LedgerEntryWhereInput = {
      occurredAt: { lt: asOf ?? undefined, gte: from ?? undefined },
    };
    const sums = await tx.ledgerEntry.groupBy({ by: ['accountCode'], where, _sum: { debit: true, credit: true } });
    const accounts = await tx.ledgerAccount.findMany({ orderBy: { code: 'asc' } });
    return accounts.map((a) => {
      const s = sums.find((x) => x.accountCode === a.code);
      const debit = s?._sum.debit ?? 0;
      const credit = s?._sum.credit ?? 0;
      const debitNormal = a.type === 'ASSET' || a.type === 'EXPENSE';
      return { ...a, debit, credit, balance: debitNormal ? debit - credit : credit - debit };
    });
  }
}
