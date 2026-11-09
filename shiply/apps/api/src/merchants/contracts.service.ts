import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@shiply/db';
import { AuditService, DB } from '../platform';

export const SIZES = ['small', 'medium', 'large', 'light_bulky', 'heavy_bulky'] as const;

/** The terms copied from one version to the next draft (everything but status and people). */
const TERMS = [
  'startDate', 'endDate', 'noticeDays', 'payoutSchedule', 'minimumPayout', 'minimumMonthlyFee', 'securityDeposit', 'creditLimit',
  'deliveryFee', 'orderFixed', 'orderPercentBp', 'codPercentBp', 'failedDeliveryFee', 'receivingPerUnit', 'storagePerUnitMonth',
  'returnPerUnit', 'packagingCharge', 'promiseMinutes', 'codFeeBp', 'returnFeeBp', 'openPackageFee', 'deliveryAttempts', 'terms', 'internalNote',
] as const;

/** Versioned contracts: draft, pending, active (after a second person approves), superseded. */
@Injectable()
export class ContractsService {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async forMerchant(merchantId: string) {
    const contract = await this.db.contract.findUnique({
      where: { merchantId },
      include: { versions: { orderBy: { version: 'desc' }, include: { prices: true, tiers: { orderBy: { minParcels: 'asc' } } } } },
    });
    return contract ?? { id: null, number: null, versions: [] };
  }

  async newDraft(merchantId: string, userId: string) {
    const merchant = await this.db.merchant.findUnique({ where: { id: merchantId } });
    if (!merchant) throw new HttpException({ error: 'not_found' }, 404);
    return this.db.$transaction(async (tx) => {
      const contract =
        (await tx.contract.findUnique({ where: { merchantId } })) ??
        (await tx.contract.create({ data: { merchantId, number: `C-${merchant.code}` } }));
      const versions = await tx.contractVersion.findMany({ where: { contractId: contract.id }, include: { prices: true, tiers: true }, orderBy: { version: 'desc' } });
      if (versions.some((v) => v.status === 'draft' || v.status === 'pending')) throw new HttpException({ error: 'draft_exists' }, 409);
      const active = versions.find((v) => v.status === 'active');
      const copy = active ? Object.fromEntries(TERMS.map((k) => [k, active[k]])) : { startDate: new Date() };
      const draft = await tx.contractVersion.create({
        data: { ...copy, startDate: active ? new Date() : (copy.startDate as Date), contractId: contract.id, version: (versions[0]?.version ?? 0) + 1, status: 'draft', createdById: userId },
      });
      if (active) {
        if (active.prices.length) await tx.parcelPrice.createMany({ data: active.prices.map((p) => ({ ...p, versionId: draft.id })) });
        if (active.tiers.length) await tx.volumeTier.createMany({ data: active.tiers.map((t) => ({ ...t, versionId: draft.id })) });
      }
      await this.audit.record(tx, { userId, action: 'contract.draft_created', entity: 'contract_version', entityId: draft.id, after: { version: draft.version } });
      return draft;
    });
  }

  async editDraft(id: string, input: Record<string, unknown> & { prices?: { pricingZoneId: string; size: string; price: number }[]; tiers?: { minParcels: number; discountBp: number }[] }, userId: string) {
    const { prices, tiers, ...terms } = input;
    return this.db.$transaction(async (tx) => {
      const v = await tx.contractVersion.findUnique({ where: { id } });
      if (!v) throw new HttpException({ error: 'not_found' }, 404);
      if (v.status !== 'draft') throw new HttpException({ error: 'not_a_draft' }, 409);
      const after = await tx.contractVersion.update({ where: { id }, data: terms });
      if (prices) {
        await tx.parcelPrice.deleteMany({ where: { versionId: id } });
        await tx.parcelPrice.createMany({ data: prices.map((p) => ({ ...p, versionId: id })) });
      }
      if (tiers) {
        await tx.volumeTier.deleteMany({ where: { versionId: id } });
        await tx.volumeTier.createMany({ data: tiers.map((t) => ({ ...t, versionId: id })) });
      }
      await this.audit.record(tx, { userId, action: 'contract.draft_changed', entity: 'contract_version', entityId: id, before: v, after });
      return after;
    });
  }

  /** Moves a version from one status to another, only if it is still in `from`. */
  private async move(id: string, from: string, to: string, data: object, userId: string, action: string) {
    return this.db.$transaction(async (tx) => {
      const { count } = await tx.contractVersion.updateMany({ where: { id, status: from }, data: { status: to, ...data } });
      if (!count) {
        const v = await tx.contractVersion.findUnique({ where: { id } });
        throw new HttpException({ error: v ? 'wrong_status' : 'not_found', status: v?.status }, v ? 409 : 404);
      }
      const v = await tx.contractVersion.findUniqueOrThrow({ where: { id } });
      if (to === 'active') {
        await tx.contractVersion.updateMany({ where: { contractId: v.contractId, status: 'active', id: { not: id } }, data: { status: 'superseded' } });
      }
      await this.audit.record(tx, { userId, action, entity: 'contract_version', entityId: id, after: { status: to } });
      return v;
    });
  }

  submit(id: string, userId: string) {
    return this.move(id, 'draft', 'pending', { submittedAt: new Date() }, userId, 'contract.submitted');
  }

  async approve(id: string, userId: string) {
    const v = await this.db.contractVersion.findUnique({ where: { id } });
    if (!v) throw new HttpException({ error: 'not_found' }, 404);
    if (v.createdById === userId) throw new HttpException({ error: 'own_version' }, 403);
    return this.move(id, 'pending', 'active', { approvedById: userId, approvedAt: new Date() }, userId, 'contract.approved');
  }

  reject(id: string, userId: string, reason: string) {
    return this.move(id, 'pending', 'rejected', { rejectedById: userId, rejectReason: reason }, userId, 'contract.rejected');
  }

  async pending() {
    const rows = await this.db.contractVersion.findMany({ where: { status: 'pending' }, orderBy: { submittedAt: 'asc' }, include: { contract: { include: { merchant: { select: { id: true, code: true, name: true } } } } } });
    return { rows, total: rows.length };
  }
}
