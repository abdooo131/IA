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
const NOT_A_SCAN = ['MARKED_LOST', 'MISSING_FROM_BAG', 'FOUND', 'DAMAGED', 'NOTE'];

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
 * The ticket's penalty waits until the search ends; finding the parcel cancels it.
 */
export async function onLost(
  tx: Tx,
  s: SettingValues,
  p: Pick<Shipment, 'id' | 'trackingNumber' | 'codAmount'>,
  reportedBy: string | null,
) {
  const searchUntil = new Date(Date.now() + s['lost.search_hours'] * HOUR);
  await tx.shipment.update({ where: { id: p.id }, data: { searchUntil } });
  const who = await lastHolder(tx, p.id);
  const courier = who?.role === 'courier' ? who : null;
  const value = Math.min(p.codAmount, s['lost.compensation_cap']);
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
    where: { entity: 'shipment', entityId: p.id, kind: 'PARCEL_IN_SEARCH', status: 'OPEN' },
    data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedById: userId, note: 'Found' },
  });
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
