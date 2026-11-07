// The code a receiver gives the courier at the door. Sent by SMS when the run leaves the hub:
// to the customer for a delivery, to the merchant for a return handed back to them.
import { createHash, randomInt } from 'node:crypto';
import { DomainError } from './errors';
import { queueMessage } from './messages';
import type { Tx } from './prisma.service';

const purpose = (shipmentId: string) => `DELIVERY:${shipmentId}`;
const hash = (shipmentId: string, code: string) => createHash('sha256').update(`${shipmentId}:${code}`).digest('hex');
const VALID_HOURS = 20;
const MAX_TRIES = 5;
const MAX_SENDS = 3;

/** Makes a new code for the parcel and queues the SMS. Returns false when the send limit is reached. */
export async function sendDeliveryCode(tx: Tx, shipmentId: string) {
  const s = await tx.shipment.findUniqueOrThrow({
    where: { id: shipmentId },
    select: { id: true, trackingNumber: true, customerPhone: true, direction: true, kind: true, merchant: { select: { name: true, phone: true } } },
  });
  const forward = s.direction === 'FORWARD';
  const phone = forward ? s.customerPhone : s.merchant.phone;
  const sent = await tx.otpCode.count({ where: { purpose: purpose(s.id), createdAt: { gte: new Date(Date.now() - VALID_HOURS * 3600e3) } } });
  if (sent >= MAX_SENDS) return false;
  const code = String(randomInt(1000, 10000));
  await tx.otpCode.updateMany({ where: { purpose: purpose(s.id), usedAt: null }, data: { expiresAt: new Date() } });
  await tx.otpCode.create({ data: { phone, purpose: purpose(s.id), codeHash: hash(s.id, code), expiresAt: new Date(Date.now() + VALID_HOURS * 3600e3) } });
  await queueMessage(tx, { to: phone, template: forward ? 'DELIVERY_CODE' : 'RETURN_CODE', vars: { store: s.merchant.name, number: s.trackingNumber, code }, shipmentId: s.id });
  return true;
}

/**
 * Checks the code the courier typed. Parcels that never had a code sent (the setting was off
 * when the run left) pass without one. Returns true when a code was checked.
 */
export async function checkDeliveryCode(tx: Tx, shipmentId: string, typed: string | undefined) {
  const any = await tx.otpCode.findFirst({ where: { purpose: purpose(shipmentId) }, select: { id: true } });
  if (!any) return false;
  const otp = await tx.otpCode.findFirst({ where: { purpose: purpose(shipmentId), usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
  if (!otp) throw new DomainError('code_expired', 'The code has expired. Send a new one to the receiver', 422);
  if (otp.attempts >= MAX_TRIES) throw new DomainError('code_locked', 'Too many wrong codes. Send a new one to the receiver', 422);
  if (!typed || hash(shipmentId, typed.trim()) !== otp.codeHash) {
    await tx.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    throw new DomainError('wrong_code', 'Wrong code. Ask the receiver for the code in the SMS', 422);
  }
  await tx.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } });
  return true;
}
