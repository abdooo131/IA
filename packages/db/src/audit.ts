import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '@prisma/client';

export interface AuditEntry {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
}

/**
 * While a second person's approval posts what someone else asked for, the change is theirs:
 * audit rows the posting writes in the asker's name are written in the approver's name, with
 * the asker and the request kept in "after" (requestedBy, requestId).
 */
const approvalContext = new AsyncLocalStorage<{
  approverId: string;
  requestedById: string;
  requestId: string;
}>();

export function auditAsApprover<T>(
  context: { approverId: string; requestedById: string; requestId: string },
  fn: () => Promise<T>,
): Promise<T> {
  return approvalContext.run(context, fn);
}

/** Writes one audit_log row. Call it inside the same transaction as the change. */
export function recordAudit(tx: Prisma.TransactionClient, entry: AuditEntry) {
  const approval = approvalContext.getStore();
  const onBehalf = !!approval && entry.actorUserId === approval.requestedById;
  const after =
    onBehalf && entry.after && typeof entry.after === 'object' && !Array.isArray(entry.after)
      ? { ...entry.after, requestedBy: approval.requestedById, requestId: approval.requestId }
      : entry.after;
  return tx.auditLog.create({
    data: {
      actorUserId: onBehalf ? approval.approverId : entry.actorUserId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before ?? undefined,
      after: after ?? undefined,
    },
  });
}
