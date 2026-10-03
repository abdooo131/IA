import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContext } from '../common/context';
import { PrismaService, Tx } from '../prisma/prisma.service';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  merchantId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string;
}

/** Writes append only audit rows. Always pass the surrounding transaction so audit and change commit together. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(tx: Tx, ctx: RequestContext, e: AuditEntry) {
    await tx.auditLog.create({
      data: {
        actorId: ctx.userId,
        actorRole: ctx.role,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId ?? null,
        merchantId: e.merchantId ?? ctx.merchantId ?? null,
        before: toJson(e.before),
        after: toJson(e.after),
        reason: e.reason ?? null,
        ip: ctx.ip ?? null,
      },
    });
  }

  async list(ctx: RequestContext, q: { entityType?: string; entityId?: string; action?: string; take?: number; cursor?: string }) {
    return this.prisma.withContext(ctx, async (tx) => {
      const rows = await tx.auditLog.findMany({
        where: {
          entityType: q.entityType || undefined,
          entityId: q.entityId || undefined,
          action: q.action ? { contains: q.action } : undefined,
          id: q.cursor ? { lt: BigInt(q.cursor) } : undefined,
        },
        orderBy: { id: 'desc' },
        take: Math.min(q.take ?? 50, 200),
      });
      return rows.map((r) => ({ ...r, id: r.id.toString() }));
    });
  }
}

function toJson(v: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (v === undefined || v === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(v, (_k, val) => (typeof val === 'bigint' ? val.toString() : val)));
}
