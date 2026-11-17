import type { Prisma } from '@prisma/client';
import type { Db } from './client';

type Tx = Prisma.TransactionClient;

/**
 * Open setup links of a person stop working (the account was disabled or the person is
 * leaving), so a link can never open a closed account again.
 */
export function expireSetupTokens(tx: Tx, userId: string, now: Date = new Date()) {
  return tx.userSetupToken.updateMany({
    where: { userId, usedAt: null, expiresAt: { gt: now } },
    data: { expiresAt: now },
  });
}

/**
 * True when a setup link issued at `issuedAt` must not open the account: the person left or
 * has a leaving recorded (not called off), or the account was disabled after the link was made
 * (links made before expireSetupTokens existed are caught by the audit trail).
 */
export async function setupLinkClosed(db: Db, userId: string, issuedAt: Date) {
  const employee = await db.employee.findUnique({
    where: { userId },
    select: { status: true, _count: { select: { exits: { where: { cancelledAt: null } } } } },
  });
  if (employee && (employee.status === 'left' || employee._count.exits > 0)) return true;
  const disabled = await db.auditLog.findFirst({
    where: {
      entityType: 'user',
      entityId: userId,
      createdAt: { gte: issuedAt },
      OR: [
        { action: 'user.disable_on_exit' },
        {
          action: 'user.update',
          AND: [
            { before: { path: ['isActive'], equals: true } },
            { after: { path: ['isActive'], equals: false } },
          ],
        },
      ],
    },
    select: { id: true },
  });
  return disabled !== null;
}
