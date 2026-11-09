import { Injectable } from '@nestjs/common';
import type { Tx } from '@shiply/db';

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

const SECRET_FIELDS = /password|hash|secret|token/i;

/** Removes secrets before anything is written to the audit log. */
function clean(v: unknown): unknown {
  if (v === null || v === undefined || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(clean);
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>)
      .filter(([k]) => !SECRET_FIELDS.test(k))
      .map(([k, val]) => [k, val instanceof Date ? val.toISOString() : clean(val)]),
  );
}

@Injectable()
export class AuditService {
  /** Always called inside the same transaction as the change it records. */
  async record(tx: Tx, e: AuditEntry) {
    await tx.auditLog.create({
      data: {
        userId: e.userId ?? null,
        action: e.action,
        entity: e.entity,
        entityId: e.entityId,
        before: (clean(e.before) ?? undefined) as never,
        after: (clean(e.after) ?? undefined) as never,
      },
    });
  }
}
