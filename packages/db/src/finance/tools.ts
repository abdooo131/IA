import { cairoDay, cairoDayStart, isCalendarDay } from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { addMonths, chargeDepreciation } from './assets';
import { eventTime } from './books';
import { post } from './ledger';

// Smaller tools on top of the books: merchants' bank details and the payout file for the
// bank, equipment sold or scrapped, accruals reversed by themselves.

// ─── merchant bank details and the payout file ─────────────────────────────────

export async function updateMerchantBank(
  db: Db,
  input: {
    merchantId: string;
    bankName?: string | null;
    bankAccountNumber?: string | null;
    iban?: string | null;
    beneficiaryName?: string | null;
    actorUserId: string;
  },
) {
  const { merchantId, actorUserId, ...data } = input;
  if (data.iban && !/^EG\d{27}$/.test(data.iban)) throw new DomainError('invalid_iban', 400);
  return inTransaction(db, async (tx) => {
    const before = await tx.merchant.findUnique({ where: { id: merchantId } });
    if (!before) throw new DomainError('merchant_not_found', 404);
    const after = await tx.merchant.update({ where: { id: merchantId }, data });
    await recordAudit(tx, {
      actorUserId,
      action: 'finance.merchant_bank',
      entityType: 'merchant',
      entityId: merchantId,
      before: {
        bankName: before.bankName,
        bankAccountNumber: before.bankAccountNumber,
        iban: before.iban,
        beneficiaryName: before.beneficiaryName,
      },
      after: {
        bankName: after.bankName,
        bankAccountNumber: after.bankAccountNumber,
        iban: after.iban,
        beneficiaryName: after.beneficiaryName,
      },
    });
    return after;
  });
}

/**
 * Draft payouts ready for the bank (approved when they needed approval), with each
 * merchant's bank details, and the ones that cannot go because details are missing.
 */
export async function payoutBankFile(db: Db) {
  const drafts = await db.payout.findMany({
    where: { status: 'draft' },
    orderBy: { number: 'asc' },
    include: { merchant: true },
  });
  const { approvalThreshold } = await import('./controls');
  const limit = await approvalThreshold(db);
  const ready = [];
  const blocked = [];
  for (const p of drafts) {
    const needsApproval = limit > 0 && p.amountPiastres >= limit && !p.approvedById;
    const m = p.merchant;
    const missingBank = !(m.iban || (m.bankName && m.bankAccountNumber));
    const row = {
      payoutId: p.id,
      number: p.number,
      merchant: m.name,
      beneficiary: m.beneficiaryName || m.legalName || m.name,
      bankName: m.bankName ?? '',
      accountNumber: m.bankAccountNumber ?? '',
      iban: m.iban ?? '',
      amountPiastres: p.amountPiastres,
    };
    if (needsApproval) blocked.push({ ...row, reason: 'approval_needed' });
    else if (missingBank) blocked.push({ ...row, reason: 'bank_details_missing' });
    else ready.push(row);
  }
  return { ready, blocked };
}

// ─── equipment sold or scrapped ────────────────────────────────────────────────

export interface DisposalInput {
  assetId: string;
  /** What it was sold for (0 when scrapped) */
  salePiastres: number;
  moneyAccountId?: string;
  reason: string;
  day?: string;
  actorUserId: string;
  idempotencyKey: string;
}

/**
 * Takes equipment off the books: its cost and the depreciation so far leave, the sale money
 * comes in, and the difference is a loss (or a gain) on equipment sold. Depreciation stops
 * from that month. Money said to come in waits for a second person, like other income.
 */
export async function disposeAsset(db: Db, input: DisposalInput) {
  if (!Number.isSafeInteger(input.salePiastres) || input.salePiastres < 0)
    throw new DomainError('invalid_amount', 400);
  if (input.reason.trim().length < 5) throw new DomainError('reason_required', 400);
  if (input.salePiastres > 0 && !input.moneyAccountId)
    throw new DomainError('account_not_found', 404);
  const at = eventTime(input.day);
  return inTransaction(db, async (tx) => {
    const key = `asset_disposal:${input.idempotencyKey}`;
    const seen = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (seen) return seen;
    await tx.$executeRaw`SELECT id FROM fixed_assets WHERE id = ${input.assetId} FOR UPDATE`;
    const asset = await tx.fixedAsset.findUnique({ where: { id: input.assetId } });
    if (!asset) throw new DomainError('asset_not_found', 404);
    if (asset.disposedAt) throw new DomainError('asset_already_disposed');
    // Depreciation stops from the disposal month. A month from then on already charged
    // (a disposal dated back) would leave depreciation booked after the asset left and
    // split the result wrongly between depreciation and the loss: refused.
    const disposalMonth = cairoDay(at).slice(0, 7);
    const [later] = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM ledger_entries
      WHERE kind = 'depreciation' AND data->>'assetId' = ${asset.id}
        AND data->>'month' >= ${disposalMonth}`;
    if (Number(later?.n ?? 0) > 0) throw new DomainError('disposal_before_charged_month');
    // Months before the disposal not charged yet are charged first, so the books are right
    // at disposal and nothing is charged after the asset is gone.
    await chargeDepreciation(tx, { ...asset, disposedAt: null }, addMonths(disposalMonth, -1));
    const [row] = await tx.$queryRaw<{ total: bigint | null }[]>`
      SELECT SUM(l.amount_piastres) AS total FROM ledger_entries e
        JOIN ledger_lines l ON l.entry_id = e.id AND l.amount_piastres > 0
      WHERE e.kind = 'depreciation' AND e.data->>'assetId' = ${asset.id}`;
    const depreciated = Number(row?.total ?? 0);
    let money: { id: string } | null = null;
    if (input.salePiastres > 0) {
      const account = await tx.ledgerAccount.findUnique({ where: { id: input.moneyAccountId! } });
      if (!account || ![1100, 1200].includes(account.groupCode))
        throw new DomainError('account_not_found', 404);
      money = account;
    }
    const loss = asset.costPiastres - depreciated - input.salePiastres;
    const entry = await post(tx, {
      kind: 'asset_disposal',
      idempotencyKey: key,
      occurredAt: at,
      createdById: input.actorUserId,
      memo: `${asset.name}: ${input.reason}`,
      darkStoreId: asset.darkStoreId,
      data: { assetId: asset.id, sale: input.salePiastres, depreciated, reason: input.reason },
      lines: [
        { account: { type: 'accumulated_depreciation' }, amount: depreciated },
        ...(money ? [{ account: { id: money.id }, amount: input.salePiastres }] : []),
        { account: { type: 'asset_disposal' }, amount: loss },
        { account: { type: 'fixed_assets' }, amount: -asset.costPiastres },
      ],
    });
    await tx.fixedAsset.update({
      where: { id: asset.id },
      data: { disposedAt: at, disposalEntryId: entry!.id },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.asset_disposal',
      entityType: 'fixed_asset',
      entityId: asset.id,
      after: { sale: input.salePiastres, depreciated, loss, reason: input.reason },
    });
    return entry!;
  });
}

// ─── accruals reversed by themselves ───────────────────────────────────────────

/**
 * Reverses every accrual whose day has come (the first day of the month after it), once:
 * the same lines with the signs turned, on that day. Run by the daily job.
 */
export async function reverseAccruals(db: Db, now: Date = new Date()) {
  const today = cairoDay(now);
  const accruals = await db.ledgerEntry.findMany({
    where: { kind: 'accrual' },
    include: { lines: true },
  });
  let reversed = 0;
  for (const a of accruals) {
    const on = (a.data as { reverseOn?: string }).reverseOn;
    if (!on || !isCalendarDay(on) || on > today) continue;
    const key = `accrual_reversal:${a.id}`;
    if (await db.ledgerEntry.findUnique({ where: { idempotencyKey: key } })) continue;
    // A reversal day inside closed books goes on the first open day instead.
    const lock = await db.booksLock.findUnique({ where: { id: 'books' } });
    const at = cairoDayStart(on);
    const entry = await post(db, {
      kind: 'accrual_reversal',
      idempotencyKey: key,
      occurredAt: lock && at < lock.lockedBefore ? lock.lockedBefore : at,
      memo: `Reversal: ${a.memo ?? ''}`.slice(0, 300),
      data: { accrualId: a.id, accrualNumber: a.number },
      lines: a.lines.map((l) => ({
        account: { id: l.accountId },
        amount: -l.amountPiastres,
        tags: {
          darkStoreId: l.darkStoreId,
          merchantId: l.merchantId,
          riderId: l.riderId,
          userId: l.userId,
        },
      })),
    });
    if (entry) reversed++;
  }
  return { reversed };
}
