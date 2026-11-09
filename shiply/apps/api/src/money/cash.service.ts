import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { PrismaClient, Tx } from '@shiply/db';
import { AuditService, DB } from '../platform';
import { LedgerService, type CompanyKey } from './ledger.service';

export const HOLDER_ACCOUNT: Record<string, string> = { rider: '1201', courier: '1201', store_box: '1202', hub_safe: '1203', agent: '1204', bank: '1101' };
export const CASH_ACCOUNTS = ['1101', '1201', '1202', '1203', '1204'];

/** One cash model for everyone who holds cash; cash moves only by a confirmed handover. */
@Injectable()
export class CashService {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  held(holderId: string, tx?: Tx) {
    return this.ledger.balance({ partyType: 'holder', partyId: holderId, accountCodes: CASH_ACCOUNTS }, tx);
  }

  /** The holder for a rider, courier, store or hub; made the first time it is needed. */
  async holderFor(tx: Tx, input: { kind: string; refId: string; nameEn: string; nameAr: string; companyKey: CompanyKey; costCentreId?: string }) {
    const found = await tx.cashHolder.findUnique({ where: { kind_refId: { kind: input.kind, refId: input.refId } } });
    return found ?? tx.cashHolder.create({ data: { ...input, accountCode: HOLDER_ACCOUNT[input.kind]! } });
  }

  /** Cash a rider or courier collected for a merchant (from the operations modules' events). */
  async collected(tx: Tx, p: { companyKey: CompanyKey; holderId: string; merchantId: string; amount: number; sourceType: string; sourceId: string }) {
    const holder = await tx.cashHolder.findUniqueOrThrow({ where: { id: p.holderId } });
    // Fails the event (it shows as a dead letter) rather than putting the cash in the wrong company.
    if (holder.companyKey !== p.companyKey) throw new Error(`cash.collected: holder ${holder.id} is in ${holder.companyKey}, not ${p.companyKey}`);
    await this.ledger.post(tx, {
      companyKey: p.companyKey,
      date: new Date(),
      memo: `COD collected (${p.sourceType} ${p.sourceId})`,
      sourceType: 'cash.collected',
      sourceId: p.sourceId,
      sourceKey: `cash.collected:${p.sourceId}`,
      lines: [
        { accountCode: holder.accountCode, debit: p.amount, credit: 0, partyType: 'holder', partyId: holder.id, costCentreId: holder.costCentreId },
        { accountCode: '2101', debit: 0, credit: p.amount, partyType: 'merchant', partyId: p.merchantId },
      ],
    });
  }

  async handOver(fromHolderId: string, toHolderId: string, amount: number, userId: string) {
    if (fromHolderId === toHolderId) throw new HttpException({ error: 'same_holder' }, 400);
    const [from, to] = await Promise.all([this.db.cashHolder.findUnique({ where: { id: fromHolderId } }), this.db.cashHolder.findUnique({ where: { id: toHolderId } })]);
    if (!from?.active || !to?.active) throw new HttpException({ error: 'not_found' }, 404);
    if (from.companyKey !== to.companyKey) throw new HttpException({ error: 'different_companies' }, 400);
    return this.db.$transaction(async (tx) => {
      // One handover at a time per giver, so two at once cannot pass what it holds.
      await lockHolder(tx, fromHolderId);
      const pending = await tx.handover.aggregate({ where: { fromHolderId, status: 'pending' }, _sum: { amount: true } });
      if (amount > (await this.held(fromHolderId, tx)) - (pending._sum.amount ?? 0)) throw new HttpException({ error: 'more_than_held' }, 400);
      const h = await tx.handover.create({ data: { fromHolderId, toHolderId, amount, createdById: userId } });
      await this.audit.record(tx, { userId, action: 'cash.handed_over', entity: 'handover', entityId: h.id, after: h });
      return h;
    });
  }

  /**
   * The receiver confirms what actually arrived (never the person who handed it over). A shortage
   * books to 5301 against the giver; extra cash books to 4306.
   */
  async confirm(id: string, received: number, userId: string) {
    return this.db.$transaction(async (tx) => {
      const h = await tx.handover.findUnique({ where: { id } });
      if (!h) throw new HttpException({ error: 'not_found' }, 404);
      if (h.createdById === userId) throw new HttpException({ error: 'own_handover' }, 403);
      const status = received === h.amount ? 'confirmed' : 'disputed';
      const { count } = await tx.handover.updateMany({ where: { id, status: 'pending' }, data: { status, confirmedAmount: received, confirmedById: userId, confirmedAt: new Date() } });
      if (!count) throw new HttpException({ error: 'already_confirmed' }, 409);
      const [from, to] = await Promise.all([tx.cashHolder.findUniqueOrThrow({ where: { id: h.fromHolderId } }), tx.cashHolder.findUniqueOrThrow({ where: { id: h.toHolderId } })]);
      const giver = { partyType: 'holder' as const, partyId: from.id, costCentreId: from.costCentreId };
      const lines = [
        { accountCode: to.accountCode, debit: received, credit: 0, partyType: 'holder' as const, partyId: to.id, costCentreId: to.costCentreId },
        { accountCode: from.accountCode, debit: 0, credit: Math.min(received, h.amount), ...giver },
      ];
      if (received < h.amount) {
        lines.push({ accountCode: '5301', debit: h.amount - received, credit: 0, ...giver }, { accountCode: from.accountCode, debit: 0, credit: h.amount - received, ...giver });
      } else if (received > h.amount) {
        lines.push({ accountCode: '4306', debit: 0, credit: received - h.amount, ...giver });
      }
      // Nothing received leaves only the shortage lines.
      const nonZero = lines.filter((l) => l.debit + l.credit > 0);
      await this.ledger.post(tx, { companyKey: from.companyKey as CompanyKey, date: new Date(), memo: `Handover ${from.nameEn} → ${to.nameEn}`, sourceType: 'handover', sourceId: id, sourceKey: `handover:${id}`, createdById: userId, lines: nonZero });
      await this.audit.record(tx, { userId, action: 'cash.confirmed', entity: 'handover', entityId: id, after: { received, status } });
      return tx.handover.findUniqueOrThrow({ where: { id } });
    });
  }
}

/** Serialises money leaving one holder inside the current transaction. */
export async function lockHolder(tx: Tx, holderId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`holder:${holderId}`}))`;
}

/**
 * A cash holder (rider, courier, box, safe, agent) cannot pay out more than it holds, less its
 * pending handovers. A bank account is not checked: its balance lives at the bank until statements
 * are imported in phase 2.
 */
export async function assertCanPay(tx: Tx, ledger: LedgerService, holder: { id: string; kind: string }, amount: number) {
  if (holder.kind === 'bank') return;
  await lockHolder(tx, holder.id);
  const held = await ledger.balance({ partyType: 'holder', partyId: holder.id, accountCodes: CASH_ACCOUNTS }, tx);
  const pending = await tx.handover.aggregate({ where: { fromHolderId: holder.id, status: 'pending' }, _sum: { amount: true } });
  if (amount > held - (pending._sum.amount ?? 0)) throw new HttpException({ error: 'more_than_held' }, 400);
}
