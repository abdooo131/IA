import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { notifyMerchant } from '../notifications';
import { balanceOf } from './ledger';

// Merchants who owe us: a merchant wallet normally holds what we owe them (COD collected
// minus our fees). When fees, storage or a damage charge pass the cash we collected, the
// wallet turns to a debit balance: the merchant owes us. Finance sees who, how much and
// since when, and can send the merchant a payment request (shown in their panel).

/** Merchants with a debit balance, largest first, with the day it last turned to debit. */
export async function merchantsOwingUs(db: Db) {
  const rows = await db.$queryRaw<
    { account_id: string; merchant_id: string; balance: bigint; since: Date | null }[]
  >`
    WITH wallets AS (
      SELECT a.id, a.merchant_id FROM ledger_accounts a WHERE a.type = 'merchant'
    ),
    running AS (
      SELECT l.account_id, l.occurred_at,
        SUM(l.amount_piastres) OVER (PARTITION BY l.account_id ORDER BY l.occurred_at, l.id) AS run
      FROM ledger_lines l JOIN wallets w ON w.id = l.account_id
    ),
    last_clear AS (
      SELECT account_id, MAX(occurred_at) FILTER (WHERE run <= 0) AS cleared
      FROM running GROUP BY account_id
    )
    SELECT w.id AS account_id, w.merchant_id,
      (SELECT SUM(amount_piastres) FROM ledger_lines WHERE account_id = w.id) AS balance,
      (SELECT MIN(r.occurred_at) FROM running r
        WHERE r.account_id = w.id AND (c.cleared IS NULL OR r.occurred_at > c.cleared)) AS since
    FROM wallets w JOIN last_clear c ON c.account_id = w.id`;
  const owing = rows.filter((r) => Number(r.balance) > 0);
  const merchants = await db.merchant.findMany({
    where: { id: { in: owing.map((r) => r.merchant_id) } },
    select: { id: true, name: true, contactPhone: true },
  });
  const requested = await db.auditLog.findMany({
    where: {
      action: 'finance.payment_requested',
      entityId: { in: owing.map((r) => r.merchant_id) },
    },
    orderBy: { createdAt: 'desc' },
    select: { entityId: true, createdAt: true },
  });
  return owing
    .map((r) => {
      const m = merchants.find((x) => x.id === r.merchant_id);
      return {
        merchantId: r.merchant_id,
        name: m?.name ?? r.merchant_id,
        phone: m?.contactPhone ?? null,
        owesPiastres: Number(r.balance),
        since: r.since,
        lastRequestedAt: requested.find((q) => q.entityId === r.merchant_id)?.createdAt ?? null,
      };
    })
    .sort((a, b) => b.owesPiastres - a.owesPiastres);
}

/** Asks a merchant who owes us to pay (a notification in their panel), audited. */
export function requestMerchantPayment(
  db: Db,
  input: { merchantId: string; note?: string; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const merchant = await tx.merchant.findUnique({ where: { id: input.merchantId } });
    if (!merchant) throw new DomainError('merchant_not_found', 404);
    const owes = await balanceOf(tx, { type: 'merchant', merchantId: merchant.id });
    if (owes <= 0) throw new DomainError('nothing_owed');
    await notifyMerchant(tx, merchant.id, 'payment_requested', {
      amountPiastres: owes,
      note: input.note ?? null,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.payment_requested',
      entityType: 'merchant',
      entityId: merchant.id,
      after: { amount: owes, note: input.note ?? null },
    });
    return { merchantId: merchant.id, owesPiastres: owes };
  });
}
