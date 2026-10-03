import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../common/context';
import { PrismaService, Tx } from '../prisma/prisma.service';

export interface AlertInput {
  kind: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  message: string;
  entityType?: string;
  entityId?: string;
  data?: Record<string, unknown>;
}

/** Operational and fraud alerts shown to staff until someone resolves them. */
@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async raise(tx: Tx, a: AlertInput) {
    // Avoid duplicates: one open alert per kind and entity.
    if (a.entityId) {
      const open = await tx.alert.findFirst({ where: { kind: a.kind, entityId: a.entityId, status: 'OPEN' } });
      if (open) return open;
    }
    return tx.alert.create({ data: { ...a, data: (a.data ?? {}) as object } });
  }

  async raiseIf(tx: Tx, condition: boolean, a: AlertInput) {
    if (condition) await this.raise(tx, a);
  }

  list(ctx: RequestContext, status = 'OPEN') {
    return this.prisma.withContext(ctx, (tx) => tx.alert.findMany({ where: { status }, orderBy: { createdAt: 'desc' }, take: 200 }));
  }

  async resolve(ctx: RequestContext, id: string, resolution: string) {
    return this.prisma.withContext(ctx, async (tx) => {
      const a = await tx.alert.findUnique({ where: { id } });
      if (!a) throw new NotFoundException('Alert not found');
      const done = await tx.alert.update({ where: { id }, data: { status: 'RESOLVED', resolution, resolvedById: ctx.userId, resolvedAt: new Date() } });
      await this.audit.record(tx, ctx, { action: 'alert.resolve', entityType: 'alert', entityId: id, before: { status: a.status }, after: { status: 'RESOLVED' }, reason: resolution });
      return done;
    });
  }
}
