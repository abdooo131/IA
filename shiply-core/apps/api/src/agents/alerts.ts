import type { Tx } from '../common/prisma.service';
import type { PrismaService } from '../common/prisma.service';

export interface AlertInput {
  kind: string;
  entity: string;
  entityId: string;
  message: string;
  agentId?: string | null;
  hubId?: string | null;
  severity?: 'normal' | 'high';
}

/** Opens an alert unless one of the same kind is already open for the same thing. */
export async function openAlert(db: Tx | PrismaService, a: AlertInput) {
  const existing = await db.alert.findFirst({ where: { kind: a.kind, entity: a.entity, entityId: a.entityId, status: 'OPEN' } });
  if (existing) return existing;
  return db.alert.create({
    data: { kind: a.kind, entity: a.entity, entityId: a.entityId, message: a.message, agentId: a.agentId ?? null, hubId: a.hubId ?? null, severity: a.severity ?? 'normal' },
  });
}

/** Closes open alerts about one thing, optionally only of some kinds. */
export async function resolveAlerts(db: Tx | PrismaService, entity: string, entityId: string, kinds?: string[], by?: string, note = '') {
  await db.alert.updateMany({
    where: { entity, entityId, status: 'OPEN', ...(kinds ? { kind: { in: kinds } } : {}) },
    data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedById: by ?? null, note },
  });
}
