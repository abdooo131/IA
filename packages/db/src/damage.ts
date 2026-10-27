import type { DamageCause, Prisma } from '@prisma/client';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';
import { post } from './finance/ledger';
import { notifyMerchant } from './notifications';
import { move } from './stock';

// Damage settlement (agreed with the business): staff choose the cause when units go to the
// damaged bin; admin settles who pays. The company pays the merchant the unit price for damage
// in its care (store handling, delivery) and may charge the rider for delivery damage; the
// merchant bears damage that arrived damaged, that the customer caused or expired goods.
//
//   staff move to damaged bin + cause ──▶ pending ──admin settles (cause may change)──▶ settled
//                                                    └─ company cause: damage_compensation
//                                                    └─ delivery + charge rider: damage_rider_charge

/** Causes for which the company compensates the merchant. */
export const COMPANY_CAUSES: DamageCause[] = ['store_handling', 'delivery'];

type Tx = Prisma.TransactionClient;

export interface ReportDamageInput {
  darkStoreId: string;
  skuId: string;
  fromBinId: string;
  quantity: number;
  cause: DamageCause;
  note?: string;
  /** Badge of the rider involved, for delivery damage */
  riderBadge?: string;
  actorUserId: string;
  idempotencyKey: string;
}

/** Moves the units to the damaged bin and opens a report, in one transaction. */
export function reportDamage(db: Db, input: ReportDamageInput) {
  return inTransaction(db, async (tx) => {
    const key = `damage:${input.idempotencyKey}`;
    const seen = await tx.stockMovement.findUnique({
      where: { idempotencyKey: key },
      include: { damage: true },
    });
    if (seen?.damage) return { report: seen.damage, replayed: true };

    const [from, target, sku] = await Promise.all([
      tx.bin.findUnique({ where: { id: input.fromBinId } }),
      tx.bin.findFirst({
        where: { darkStoreId: input.darkStoreId, type: 'damaged', isActive: true },
        orderBy: { code: 'asc' },
      }),
      tx.sku.findUnique({ where: { id: input.skuId } }),
    ]);
    if (!from || from.darkStoreId !== input.darkStoreId)
      throw new DomainError('bin_not_found', 404);
    if (!['pickable', 'receiving', 'held'].includes(from.type))
      throw new DomainError('move_not_allowed', 400);
    if (!target) throw new DomainError('no_damaged_bin');
    if (!sku) throw new DomainError('sku_not_found', 404);

    let riderId: string | null = null;
    if (input.riderBadge?.trim()) {
      const rider = await tx.rider.findUnique({ where: { badgeCode: input.riderBadge.trim() } });
      if (!rider || rider.darkStoreId !== input.darkStoreId)
        throw new DomainError('rider_not_found', 404);
      riderId = rider.id;
    }

    const { movement } = await move(tx, {
      skuId: input.skuId,
      fromBinId: from.id,
      toBinId: target.id,
      quantity: input.quantity,
      reason: `damaged:${input.cause}`,
      actorUserId: input.actorUserId,
      idempotencyKey: key,
    });
    const report = await tx.damageReport.create({
      data: {
        darkStoreId: input.darkStoreId,
        merchantId: sku.merchantId,
        skuId: sku.id,
        quantity: input.quantity,
        cause: input.cause,
        note: input.note?.trim() || null,
        riderId,
        movementId: movement.id,
        reportedById: input.actorUserId,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'damage.report',
      entityType: 'damage_report',
      entityId: report.id,
      after: { sku: sku.sku, quantity: input.quantity, cause: input.cause, riderId },
    });
    return { report, replayed: false };
  });
}

export interface SettleDamageInput {
  reportId: string;
  /** The cause admin confirms, possibly different from what staff chose */
  cause: DamageCause;
  chargeRider: boolean;
  note?: string;
  actorUserId: string;
  now?: Date;
}

async function lockReport(tx: Tx, reportId: string) {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM damage_reports WHERE id = ${reportId} FOR UPDATE`;
  if (rows.length === 0) throw new DomainError('damage_not_found', 404);
  return tx.damageReport.findUniqueOrThrow({
    where: { id: reportId },
    include: { sku: true },
  });
}

/** Admin decides who pays. Money moves in the same transaction; settling twice is refused. */
export function settleDamage(db: Db, input: SettleDamageInput) {
  return inTransaction(db, async (tx) => {
    const now = input.now ?? new Date();
    const report = await lockReport(tx, input.reportId);
    if (report.status !== 'pending') throw new DomainError('damage_already_settled');
    const companyPays = COMPANY_CAUSES.includes(input.cause);
    if (input.chargeRider && (input.cause !== 'delivery' || !report.riderId))
      throw new DomainError('rider_charge_not_allowed', 400);
    if (input.cause !== report.cause && !input.note?.trim())
      throw new DomainError('note_required', 400);

    const compensation = companyPays ? report.quantity * report.sku.pricePiastres : 0;
    const riderCharge = input.chargeRider ? compensation : 0;
    const base = { occurredAt: now, createdById: input.actorUserId, memo: report.sku.sku };
    await post(tx, {
      ...base,
      kind: 'damage_compensation',
      idempotencyKey: `damage:${report.id}:compensation`,
      data: { damageId: report.id, quantity: report.quantity, cause: input.cause },
      lines: [
        { account: { type: 'damage_expense' }, amount: compensation },
        { account: { type: 'merchant', merchantId: report.merchantId }, amount: -compensation },
      ],
    });
    if (riderCharge > 0) {
      // The rider owes the amount like missing cash; it is settled at the next cash handover.
      await post(tx, {
        ...base,
        kind: 'damage_rider_charge',
        idempotencyKey: `damage:${report.id}:rider_charge`,
        data: { damageId: report.id, riderId: report.riderId },
        lines: [
          { account: { type: 'rider_cash', riderId: report.riderId! }, amount: riderCharge },
          { account: { type: 'damage_expense' }, amount: -riderCharge },
        ],
      });
    }
    await tx.damageReport.update({
      where: { id: report.id },
      data: {
        status: 'settled',
        cause: input.cause,
        settledById: input.actorUserId,
        settledAt: now,
        settleNote: input.note?.trim() || null,
        compensationPiastres: compensation,
        riderChargePiastres: riderCharge,
      },
    });
    await notifyMerchant(tx, report.merchantId, 'damage_settled', {
      damageId: report.id,
      sku: report.sku.sku,
      quantity: report.quantity,
      cause: input.cause,
      compensationPiastres: compensation,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'damage.settle',
      entityType: 'damage_report',
      entityId: report.id,
      before: { status: 'pending', cause: report.cause },
      after: {
        status: 'settled',
        cause: input.cause,
        compensation,
        riderCharge,
        note: input.note ?? null,
      },
    });
    return {
      status: 'settled' as const,
      compensationPiastres: compensation,
      riderChargePiastres: riderCharge,
    };
  });
}

export async function listDamageReports(
  db: Db,
  filter: { status?: 'pending' | 'settled'; merchantId?: string; darkStoreId?: string },
) {
  const rows = await db.damageReport.findMany({
    where: filter,
    include: {
      sku: { select: { sku: true, titleEn: true, titleAr: true, pricePiastres: true } },
      merchant: { select: { id: true, name: true } },
      darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      rider: { select: { badgeCode: true, user: { select: { name: true } } } },
      reportedBy: { select: { name: true } },
      settledBy: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 300,
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    cause: r.cause,
    note: r.note,
    quantity: r.quantity,
    sku: r.sku.sku,
    titleEn: r.sku.titleEn,
    titleAr: r.sku.titleAr,
    valuePiastres: r.quantity * r.sku.pricePiastres,
    merchant: r.merchant,
    darkStore: r.darkStore,
    rider: r.rider ? { badgeCode: r.rider.badgeCode, name: r.rider.user.name } : null,
    reportedBy: r.reportedBy.name,
    settledBy: r.settledBy?.name ?? null,
    settledAt: r.settledAt?.toISOString() ?? null,
    settleNote: r.settleNote,
    compensationPiastres: r.compensationPiastres,
    riderChargePiastres: r.riderChargePiastres,
    createdAt: r.createdAt.toISOString(),
  }));
}
