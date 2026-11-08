// Merchant claims (owner, 2026-11-08): nobody on the floor reports damage. A parcel that reaches
// the customer or comes back damaged, or never arrives, is claimed by the merchant from their
// portal; operations approve (the wallet is credited) or reject with a reason. A lost claim
// starts the parcel's search; confirming the loss approves it, finding the parcel closes it.
import { Injectable } from '@nestjs/common';
import { ACCOUNTS } from '@shiplynow/shared/parcels';
import { z } from 'zod';
import type { SessionUser } from '../auth/auth';
import { nextCode } from '../common/codes';
import { DomainError, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { parse } from '../common/validate';
import { ShipmentsCore } from '../core/shipments.core';
import { post } from '../finance/ledger';
import { compensationFor, onLost } from './lost';

const ClaimInput = z.object({
  trackingNumber: z.string().trim().min(3).max(40),
  kind: z.enum(['lost', 'damaged']),
  description: z.string().trim().min(5, 'Say what happened').max(1000),
  photo: z.object({ mime: z.string().max(60), dataBase64: z.string().min(8) }).nullish(),
});
const ApproveInput = z.object({
  /** Piastres; empty pays the full compensation (declared value up to the cap plus the fee). */
  amount: z.number().int().min(1).nullish(),
  note: z.string().trim().max(500).default(''),
});
const RejectInput = z.object({ note: z.string().trim().min(5, 'Say why').max(500) });

/** Arrived (to the customer or back to the merchant): only then can it be claimed damaged. */
const ARRIVED = ['DELIVERED', 'RETURNED'];
/** Finished or already searched for: a lost claim makes no sense then. */
const NOT_LOSABLE = ['DELIVERED', 'RETURNED', 'CANCELLED', 'CREATED'];

function photoBytes(p: { dataBase64: string }) {
  const clean = p.dataBase64.includes(',')
    ? p.dataBase64.slice(p.dataBase64.indexOf(',') + 1)
    : p.dataBase64;
  const buf = Buffer.from(clean, 'base64');
  if (buf.length === 0 || buf.length > 3 * 1024 * 1024)
    throw new DomainError('invalid_input', 'The photo must be under 3 MB', 422);
  return new Uint8Array(buf);
}

const view = {
  id: true,
  code: true,
  kind: true,
  description: true,
  status: true,
  amount: true,
  decisionNote: true,
  decidedAt: true,
  createdAt: true,
  photoMime: true,
  shipment: {
    select: {
      id: true,
      trackingNumber: true,
      status: true,
      customerName: true,
      codAmount: true,
      declaredValue: true,
      shippingFee: true,
      lostFinalAt: true,
      searchUntil: true,
    },
  },
  merchant: { select: { id: true, name: true } },
} as const;

@Injectable()
export class ClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly core: ShipmentsCore,
  ) {}

  /** The merchant opens a claim on one of their parcels. */
  async open(merchantId: string, body: unknown, user: SessionUser) {
    const d = parse(ClaimInput, body);
    const s = await this.settings.all();
    return this.prisma.tx(async (tx) => {
      const p = await tx.shipment.findUnique({ where: { trackingNumber: d.trackingNumber } });
      if (!p || p.merchantId !== merchantId) throw notFound('Parcel');
      if (d.kind === 'damaged' && !ARRIVED.includes(p.status))
        throw new DomainError(
          'not_arrived',
          'A damage claim is for a parcel that was delivered or came back to you',
          409,
        );
      if (d.kind === 'lost' && NOT_LOSABLE.includes(p.status))
        throw new DomainError(
          'not_losable',
          'This parcel is not on its way, so it cannot be claimed lost',
          409,
        );
      const open = await tx.merchantClaim.findFirst({
        where: { shipmentId: p.id, kind: d.kind, status: { in: ['OPEN', 'APPROVED'] } },
      });
      if (open)
        throw new DomainError(
          'claim_open',
          `Claim ${open.code} is already open for this parcel`,
          409,
        );
      const claim = await tx.merchantClaim.create({
        data: {
          code: await nextCode(tx, 'claim_seq', 'CLM'),
          merchantId,
          shipmentId: p.id,
          kind: d.kind,
          description: d.description,
          photo: d.photo ? photoBytes(d.photo) : null,
          photoMime: d.photo?.mime ?? '',
          createdById: user.id,
        },
        select: view,
      });
      // A lost claim starts the search at once (unless it is already searched for).
      if (d.kind === 'lost' && p.status !== 'LOST') {
        await this.core.move(
          tx,
          p,
          'LOST',
          { bagId: null, runId: null, currentHubId: null, laneHubId: null },
          {
            type: 'CLAIMED_LOST',
            hubId: p.currentHubId,
            userId: user.id,
            note: `Merchant claim ${claim.code}: the search started`,
          },
        );
        await onLost(tx, s, p, user.id);
      }
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'CLAIM_OPENED',
          entityType: 'merchant_claim',
          entityId: claim.id,
          after: { code: claim.code, kind: d.kind, trackingNumber: p.trackingNumber },
        },
      });
      return claim;
    });
  }

  mine(merchantId: string) {
    return this.prisma.merchantClaim.findMany({
      where: { merchantId },
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: view,
    });
  }

  /** Operations' list with what each claim would pay in full. */
  async list(status?: string) {
    const s = await this.settings.all();
    const rows = await this.prisma.merchantClaim.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: view,
    });
    return rows.map((r) => ({ ...r, fullAmount: compensationFor(s, r.shipment) }));
  }

  /** Approves a damage claim: the merchant's wallet is credited. Lost claims wait for the search. */
  async approve(id: string, body: unknown, user: SessionUser) {
    const d = parse(ApproveInput, body);
    const s = await this.settings.all();
    return this.prisma.tx(async (tx) => {
      const c = await tx.merchantClaim.findUnique({ where: { id }, include: { shipment: true } });
      if (!c) throw notFound('Claim');
      if (c.status !== 'OPEN')
        throw new DomainError('bad_status', 'This claim was already decided', 409);
      if (c.kind === 'lost')
        throw new DomainError(
          'confirm_loss_instead',
          'A lost claim is approved by confirming the loss on the Lost parcels page once the search ends',
          409,
        );
      const full = compensationFor(s, c.shipment);
      const amount = d.amount ?? full;
      if (amount > full)
        throw new DomainError(
          'over_limit',
          `At most ${(full / 100).toFixed(2)} EGP: the declared value up to the cap, plus the shipping fee`,
          422,
        );
      await post(tx, {
        memo: `Claim ${c.code}: ${c.shipment.trackingNumber} damaged, merchant compensated`,
        source: 'CLAIM_COMPENSATION',
        key: `CLAIM_COMPENSATION:${c.id}`,
        userId: user.id,
        lines: [
          { account: ACCOUNTS.LOST_PARCELS.code, debit: amount },
          {
            account: ACCOUNTS.MERCHANT_WALLET.code,
            party: { type: 'MERCHANT', id: c.merchantId },
            credit: amount,
          },
        ],
      });
      await tx.merchantClaim.update({
        where: { id },
        data: {
          status: 'APPROVED',
          amount,
          decisionNote: d.note,
          decidedById: user.id,
          decidedAt: new Date(),
        },
      });
      await tx.shipment.update({ where: { id: c.shipmentId }, data: { damaged: true } });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'CLAIM_APPROVED',
          entityType: 'merchant_claim',
          entityId: id,
          after: { amount, note: d.note },
        },
      });
      return { amount };
    });
  }

  async reject(id: string, body: unknown, user: SessionUser) {
    const d = parse(RejectInput, body);
    return this.prisma.tx(async (tx) => {
      const c = await tx.merchantClaim.findUnique({ where: { id } });
      if (!c) throw notFound('Claim');
      if (c.status !== 'OPEN')
        throw new DomainError('bad_status', 'This claim was already decided', 409);
      await tx.merchantClaim.update({
        where: { id },
        data: {
          status: 'REJECTED',
          decisionNote: d.note,
          decidedById: user.id,
          decidedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'CLAIM_REJECTED',
          entityType: 'merchant_claim',
          entityId: id,
          after: { note: d.note },
        },
      });
      return { ok: true };
    });
  }

  async photo(id: string, merchantId?: string) {
    const c = await this.prisma.merchantClaim.findUnique({
      where: { id },
      select: { photo: true, photoMime: true, merchantId: true, code: true },
    });
    if (!c?.photo || (merchantId && c.merchantId !== merchantId)) throw notFound('Photo');
    return { data: c.photo, mime: c.photoMime, name: c.code };
  }
}
