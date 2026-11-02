import { addDays, cairoDay, cairoDayStart, isCalendarDay } from '@shiplynow/shared';
import { recordAudit } from '../audit';
import { type Db, inTransaction } from '../client';
import { DomainError } from '../domain-error';
import { eventTime } from './books';
import { balanceOf, post } from './ledger';

// Smaller tools on top of the books: merchants' bank details and the payout file for the
// bank, equipment sold or scrapped, accruals reversed by themselves, and the partner
// ledger (every account one person or company has with us, together).

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

// ─── partner ledger ────────────────────────────────────────────────────────────

export type PartnerKind = 'merchant' | 'supplier' | 'person';

/** The accounts that belong to one merchant (with its linked supplier), supplier or person. */
async function partnerAccounts(db: Db, kind: PartnerKind, id: string) {
  if (kind === 'merchant') {
    const merchant = await db.merchant.findUnique({
      where: { id },
      include: { supplierSelf: { select: { id: true } } },
    });
    if (!merchant) throw new DomainError('partner_not_found', 404);
    const accounts = await db.ledgerAccount.findMany({
      where: {
        OR: [
          { merchantId: id },
          ...(merchant.supplierSelf ? [{ supplierId: merchant.supplierSelf.id }] : []),
        ],
      },
    });
    return { name: merchant.legalName ?? merchant.name, accounts };
  }
  if (kind === 'supplier') {
    const supplier = await db.supplier.findUnique({ where: { id } });
    if (!supplier) throw new DomainError('partner_not_found', 404);
    if (supplier.merchantId) return partnerAccounts(db, 'merchant', supplier.merchantId);
    return {
      name: supplier.name,
      accounts: await db.ledgerAccount.findMany({ where: { supplierId: id } }),
    };
  }
  const user = await db.user.findUnique({ where: { id }, include: { rider: true } });
  if (!user) throw new DomainError('partner_not_found', 404);
  const accounts = await db.ledgerAccount.findMany({
    where: { OR: [{ userId: id }, ...(user.rider ? [{ riderId: user.rider.id }] : [])] },
  });
  return { name: user.name, accounts };
}

/**
 * Every partner with an account: merchants (and the supplier that is the same company),
 * other suppliers and team members. Net is what they owe us (positive) or we owe them
 * (negative), across all their accounts.
 */
export async function listPartners(db: Db) {
  const accounts = await db.ledgerAccount.findMany({
    where: {
      OR: [
        { merchantId: { not: null } },
        { supplierId: { not: null } },
        { riderId: { not: null } },
        { userId: { not: null } },
      ],
    },
    select: { id: true, merchantId: true, supplierId: true, riderId: true, userId: true },
  });
  const sums = await db.ledgerLine.groupBy({
    by: ['accountId'],
    where: { accountId: { in: accounts.map((a) => a.id) } },
    _sum: { amountPiastres: true },
  });
  const balance = (id: string) => sums.find((s) => s.accountId === id)?._sum.amountPiastres ?? 0;
  const [merchants, suppliers, riders, users] = await Promise.all([
    db.merchant.findMany({ select: { id: true, name: true, legalName: true } }),
    db.supplier.findMany({ select: { id: true, name: true, merchantId: true } }),
    db.rider.findMany({ select: { id: true, userId: true } }),
    db.user.findMany({
      where: { role: { not: 'merchant' } },
      select: { id: true, name: true, role: true },
    }),
  ]);
  const partners = new Map<
    string,
    {
      kind: PartnerKind;
      id: string;
      name: string;
      accounts: number;
      netPiastres: number;
      detail: string;
    }
  >();
  const add = (kind: PartnerKind, id: string, name: string, detail: string, amount: number) => {
    const key = `${kind}:${id}`;
    const p = partners.get(key) ?? { kind, id, name, accounts: 0, netPiastres: 0, detail };
    p.accounts += 1;
    p.netPiastres += amount;
    partners.set(key, p);
  };
  for (const a of accounts) {
    const amount = balance(a.id);
    if (a.merchantId) {
      const m = merchants.find((x) => x.id === a.merchantId);
      add('merchant', a.merchantId, m?.legalName ?? m?.name ?? '', 'merchant', amount);
    } else if (a.supplierId) {
      const s = suppliers.find((x) => x.id === a.supplierId);
      if (s?.merchantId) {
        const m = merchants.find((x) => x.id === s.merchantId);
        add('merchant', s.merchantId, m?.legalName ?? m?.name ?? '', 'merchant', amount);
      } else add('supplier', a.supplierId, s?.name ?? '', 'supplier', amount);
    } else {
      const userId = a.userId ?? riders.find((r) => r.id === a.riderId)?.userId;
      const u = users.find((x) => x.id === userId);
      if (userId) add('person', userId, u?.name ?? '', u?.role ?? 'person', amount);
    }
  }
  return [...partners.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** One partner's movements across all their accounts, with the net running balance. */
export async function partnerLedger(
  db: Db,
  input: { kind: PartnerKind; id: string; from?: string; to?: string },
) {
  const { name, accounts } = await partnerAccounts(db, input.kind, input.id);
  const ids = accounts.map((a) => a.id);
  const from = input.from && isCalendarDay(input.from) ? cairoDayStart(input.from) : undefined;
  const to = input.to && isCalendarDay(input.to) ? cairoDayStart(addDays(input.to, 1)) : undefined;
  const opening = from
    ? ((
        await db.ledgerLine.aggregate({
          where: { accountId: { in: ids }, occurredAt: { lt: from } },
          _sum: { amountPiastres: true },
        })
      )._sum.amountPiastres ?? 0)
    : 0;
  const lines = await db.ledgerLine.findMany({
    where: { accountId: { in: ids }, occurredAt: { gte: from, lt: to } },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    include: { entry: { select: { number: true, kind: true, memo: true } } },
    take: 2000,
  });
  let running = opening;
  return {
    kind: input.kind,
    id: input.id,
    name,
    accounts: await Promise.all(
      accounts.map(async (a) => ({
        id: a.id,
        code: a.code,
        type: a.type,
        groupCode: a.groupCode,
        balancePiastres: await balanceOf(db, { id: a.id }),
      })),
    ),
    openingPiastres: opening,
    lines: lines.map((l) => {
      running += l.amountPiastres;
      const account = accounts.find((a) => a.id === l.accountId)!;
      return {
        id: l.id,
        at: l.occurredAt,
        entryNumber: l.entry.number,
        kind: l.entry.kind,
        memo: l.entry.memo,
        accountCode: account.code,
        accountType: account.type,
        amountPiastres: l.amountPiastres,
        runningPiastres: running,
      };
    }),
    netPiastres: running,
  };
}

/** Marks a supplier as the same company as a merchant (or undoes it). */
export async function linkSupplierToMerchant(
  db: Db,
  input: { supplierId: string; merchantId: string | null; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier) throw new DomainError('supplier_not_found', 404);
    if (input.merchantId) {
      if (!(await tx.merchant.findUnique({ where: { id: input.merchantId } })))
        throw new DomainError('merchant_not_found', 404);
      const taken = await tx.supplier.findFirst({
        where: { merchantId: input.merchantId, id: { not: supplier.id } },
      });
      if (taken) throw new DomainError('merchant_already_linked');
    }
    const after = await tx.supplier.update({
      where: { id: supplier.id },
      data: { merchantId: input.merchantId },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'finance.supplier_link',
      entityType: 'supplier',
      entityId: supplier.id,
      before: { merchantId: supplier.merchantId },
      after: { merchantId: after.merchantId },
    });
    return { supplierId: after.id, merchantId: after.merchantId };
  });
}
