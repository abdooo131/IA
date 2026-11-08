// What happens when a parcel goes missing and when it turns up again. Called inside the same
// transaction as the scan or the decision, so the parcel, the ticket and the money move together.
import type { Shipment } from '@shiplynow/db';
import { ACCOUNTS, type SettingValues } from '@shiplynow/shared/parcels';
import { openAlert } from '../agents/alerts';
import { nextCode } from '../common/codes';
import type { Tx } from '../common/prisma.service';
import { post } from '../finance/ledger';
import { earn } from '../finance/postings';

const HOUR = 3600 * 1000;
/** Events that report a problem rather than someone handling the parcel. */
export const NOT_A_SCAN = [
  'MARKED_LOST',
  'MISSING_FROM_BAG',
  'AUTO_SEARCH',
  'CLAIMED_LOST',
  'LOSS_FINAL',
  'FOUND',
  'DAMAGED',
  'NOTE',
];

/** The person whose scan came last before the problem: they are held responsible. */
export async function lastHolder(tx: Tx, shipmentId: string, notUserId?: string) {
  const ev = await tx.shipmentEvent.findFirst({
    where: {
      shipmentId,
      NOT: { userId: null },
      type: { notIn: NOT_A_SCAN },
      ...(notUserId ? { userId: { not: notUserId } } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!ev?.userId) return null;
  const u = await tx.user.findUnique({
    where: { id: ev.userId },
    select: { id: true, name: true, role: true, hubId: true, agentId: true },
  });
  return u ? { ...u, eventType: ev.type, at: ev.createdAt, eventHubId: ev.hubId } : null;
}

export async function newTicketCode(tx: Tx) {
  return nextCode(tx, 'control_seq', 'QC');
}

/**
 * A parcel went missing: it is searched for, and a ticket opens against whoever scanned it last.
 * The ticket's penalty waits until a person confirms the loss; finding the parcel cancels it.
 */
export async function onLost(
  tx: Tx,
  s: SettingValues,
  p: Pick<Shipment, 'id' | 'trackingNumber' | 'codAmount'> & {
    currentHubId?: string | null;
    declaredValue?: number;
  },
  reportedBy: string | null,
) {
  const now = new Date();
  const searchUntil = new Date(now.getTime() + s['lost.search_hours'] * HOUR);
  const who = await lastHolder(tx, p.id);
  // The station that had it last: the parcel left that station's stock when its search began.
  const lostHubId = p.currentHubId ?? who?.eventHubId ?? who?.hubId ?? null;
  await tx.shipment.update({
    where: { id: p.id },
    data: { searchUntil, searchStartedAt: now, lostHubId },
  });
  const courier = who?.role === 'courier' ? who : null;
  // The courier carries what the merchant is paid for it: the declared value, else the cash.
  const value = Math.min(
    p.declaredValue && p.declaredValue > 0 ? p.declaredValue : p.codAmount,
    s['lost.compensation_cap'],
  );
  await tx.qcTicket.create({
    data: {
      code: await newTicketCode(tx),
      kind: 'MISSING_PARCEL',
      shipmentId: p.id,
      courierId: courier?.id ?? null,
      agentId: courier?.agentId ?? null,
      hubId: who?.eventHubId ?? who?.hubId ?? null,
      responsibleId: who?.id ?? null,
      description: `${p.trackingNumber} is missing. Last handled by ${who ? who.name : 'nobody on record'}${who ? ` (${who.eventType.toLowerCase().replace(/_/g, ' ')})` : ''}`,
      // Couriers carry the loss; company staff do not have wallets, the hub's ticket records it.
      penalty: courier ? value : 0,
      confirmAt: searchUntil,
      createdById: reportedBy,
    },
  });
  await openAlert(tx, {
    kind: 'PARCEL_IN_SEARCH',
    entity: 'shipment',
    entityId: p.id,
    agentId: courier?.agentId ?? null,
    hubId: who?.eventHubId ?? null,
    severity: 'high',
    message: `${p.trackingNumber} is missing. Search for it before ${searchUntil.toISOString()}`,
  });
}

/** The parcel turned up: cancel the search, its ticket, and any compensation already paid. */
export async function onFound(
  tx: Tx,
  s: SettingValues,
  p: Pick<Shipment, 'id' | 'trackingNumber' | 'merchantId' | 'compensation' | 'lostFinalAt'>,
  userId: string,
) {
  await tx.shipment.update({
    where: { id: p.id },
    data: { searchUntil: null, lostFinalAt: null, compensation: 0 },
  });
  if (p.lostFinalAt && p.compensation > 0) {
    await post(tx, {
      memo: `${p.trackingNumber} found: compensation taken back`,
      source: 'LOST_FOUND',
      key: `LOST_FOUND:${p.id}:${p.lostFinalAt.getTime()}`,
      userId,
      lines: [
        {
          account: ACCOUNTS.MERCHANT_WALLET.code,
          party: { type: 'MERCHANT', id: p.merchantId },
          debit: p.compensation,
        },
        { account: ACCOUNTS.LOST_PARCELS.code, credit: p.compensation },
      ],
    });
  }
  const tickets = await tx.qcTicket.findMany({
    where: {
      shipmentId: p.id,
      kind: 'MISSING_PARCEL',
      status: { in: ['OPEN', 'CONFIRMED', 'APPEALED', 'UPHELD'] },
    },
  });
  for (const t of tickets) {
    if (t.status === 'OPEN') {
      await tx.qcTicket.update({
        where: { id: t.id },
        data: { status: 'OVERRIDDEN', overrideReason: 'Parcel found', decidedById: userId },
      });
    } else {
      await reverseTicket(tx, s, t, userId, 'Parcel found');
    }
  }
  await tx.networkAlert.updateMany({
    where: {
      entity: 'shipment',
      entityId: p.id,
      kind: { in: ['PARCEL_IN_SEARCH', 'LOST_TO_CONFIRM'] },
      status: 'OPEN',
    },
    data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedById: userId, note: 'Found' },
  });
  await tx.shipment.update({
    where: { id: p.id },
    data: { searchStartedAt: null, lostHubId: null, lostConfirmedById: null },
  });
  // The merchant's claim that it was lost ends: found (any compensation was taken back above).
  await tx.merchantClaim.updateMany({
    where: { shipmentId: p.id, kind: 'lost', status: { in: ['OPEN', 'APPROVED'] } },
    data: {
      status: 'REJECTED',
      decisionNote: 'The parcel was found and continues on its way',
      decidedById: userId,
      decidedAt: new Date(),
    },
  });
}

/**
 * What a merchant is paid for a lost or damaged parcel: the value they declared (else the cash
 * to collect), up to the cap, plus the shipping fee back when it was charged. The fee is booked
 * only when a parcel is delivered or returned, so a lost parcel never paid it and gets the value
 * alone.
 */
export function compensationFor(
  s: SettingValues,
  p: Pick<Shipment, 'declaredValue' | 'codAmount' | 'shippingFee' | 'status'>,
) {
  const value = p.declaredValue > 0 ? p.declaredValue : p.codAmount;
  const feeCharged = p.status === 'DELIVERED' || p.status === 'RETURNED';
  return Math.min(value, s['lost.compensation_cap']) + (feeCharged ? p.shippingFee : 0);
}

/** Gives back a penalty that was applied. */
export async function reverseTicket(
  tx: Tx,
  s: SettingValues,
  t: { id: string; code: string; courierId: string | null; penalty: number; status: string },
  userId: string,
  note: string,
) {
  await tx.qcTicket.update({
    where: { id: t.id },
    data: { status: 'REVERSED', decisionNote: note, decidedById: userId },
  });
  if (t.courierId && t.penalty > 0 && t.status !== 'OPEN') {
    await earn(tx, s, {
      courierId: t.courierId,
      kind: 'ADJUSTMENT',
      amount: t.penalty,
      note: `Penalty ${t.code} reversed: ${note}`,
      userId,
      contra: { account: ACCOUNTS.OTHER_INCOME.code },
    });
  }
}
