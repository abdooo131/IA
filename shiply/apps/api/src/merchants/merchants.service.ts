import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { PrismaClient, Tx } from '@shiply/db';
import { normalizeEgyptMobile } from '@shiply/shared';
import { LocationService } from '../location';
import { AuditService, DB } from '../platform';

export interface MerchantInput {
  name: string;
  contactName: string;
  contactPhone: string;
  contactEmail?: string;
  services: string[];
  pickupAddress?: string;
  legalName?: string;
  billingEmails?: string[];
  emailLanguage?: 'ar' | 'en';
  taxNumber?: string;
  taxGovernorate?: string;
  taxCity?: string;
  taxStreet?: string;
  taxBuilding?: string;
  bankName?: string;
  bankAccount?: string;
  iban?: string;
  beneficiary?: string;
  accountManagerId?: string;
  flexShip?: boolean;
}

/** The one merchant record for both services. */
@Injectable()
export class MerchantsService {
  constructor(
    @Inject(DB) private readonly db: PrismaClient,
    @Inject(LocationService) private readonly location: LocationService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  get(id: string) {
    return this.db.merchant.findUnique({ where: { id } });
  }

  /** "Eve Chantelle" → EVE, then EVE2, EVE3 when taken. */
  private async newCode(tx: Tx, name: string): Promise<string> {
    const word = (name.trim().split(/\s+/)[0] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'M';
    for (let n = 1; ; n++) {
      const code = n === 1 ? word : `${word}${n}`;
      if (!(await tx.merchant.findUnique({ where: { code } }))) return code;
    }
  }

  private phone(p: string): string {
    const n = normalizeEgyptMobile(p);
    if (!n) throw new HttpException({ error: 'invalid_mobile' }, 400);
    return n;
  }

  /** Places the pickup address through Location; an unclear one waits in its queue. */
  private async placePickup(tx: Tx, merchantId: string, text: string) {
    const r = await this.location.resolve(tx, { service: 'shiply', refType: 'merchant_pickup', refId: merchantId, text });
    return { pickupAddress: text, pickupPlaceId: r.placeId, pickupDecisionId: r.decisionId };
  }

  async create(tx: Tx, input: MerchantInput, userId: string | null, status: 'approved' | 'pending' = 'approved') {
    const code = await this.newCode(tx, input.name);
    const { pickupAddress, ...rest } = input;
    const m = await tx.merchant.create({ data: { ...rest, code, contactPhone: this.phone(input.contactPhone), billingEmails: input.billingEmails ?? [], status } });
    const pickup = pickupAddress ? await this.placePickup(tx, m.id, pickupAddress) : {};
    const saved = await tx.merchant.update({ where: { id: m.id }, data: pickup });
    await this.audit.record(tx, { userId, action: 'merchant.created', entity: 'merchant', entityId: m.id, after: saved });
    return saved;
  }

  /** Used by Sales when a deal is won. */
  createFromDeal(tx: Tx, input: MerchantInput, userId: string) {
    return this.create(tx, input, userId, 'approved');
  }

  async update(id: string, input: Partial<MerchantInput>, userId: string) {
    const before = await this.db.merchant.findUnique({ where: { id } });
    if (!before) throw new HttpException({ error: 'not_found' }, 404);
    return this.db.$transaction(async (tx) => {
      const { pickupAddress, contactPhone, ...rest } = input;
      const pickup = pickupAddress !== undefined && pickupAddress !== before.pickupAddress ? await this.placePickup(tx, id, pickupAddress) : {};
      const after = await tx.merchant.update({ where: { id }, data: { ...rest, ...(contactPhone ? { contactPhone: this.phone(contactPhone) } : {}), ...pickup } });
      await this.audit.record(tx, { userId, action: 'merchant.changed', entity: 'merchant', entityId: id, before, after });
      return after;
    });
  }

  /** Moves a merchant from one status to another, only from the given ones. */
  async setStatus(id: string, from: string[], to: string, userId: string, reason?: string) {
    return this.db.$transaction(async (tx) => {
      const { count } = await tx.merchant.updateMany({ where: { id, status: { in: from } }, data: { status: to, rejectReason: reason ?? null } });
      if (!count) {
        const exists = await tx.merchant.findUnique({ where: { id } });
        throw new HttpException({ error: exists ? 'wrong_status' : 'not_found', status: exists?.status }, exists ? 409 : 404);
      }
      await this.audit.record(tx, { userId, action: `merchant.${to}`, entity: 'merchant', entityId: id, after: { status: to, reason } });
      return tx.merchant.findUniqueOrThrow({ where: { id } });
    });
  }

  /** A pickup address that waited in the Location queue gets its area. */
  async pickupResolved(tx: Tx, merchantId: string, decisionId: string, placeId: string) {
    await tx.merchant.updateMany({ where: { id: merchantId, pickupDecisionId: decisionId }, data: { pickupPlaceId: placeId } });
  }
}
