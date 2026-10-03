import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../common/context';
import { PrismaService, Tx } from '../prisma/prisma.service';

/** Reads business values from system_config. No in process cache, so admin edits apply immediately. */
@Injectable()
export class ConfigService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async getMany(keys: string[], tx?: Tx): Promise<Record<string, unknown>> {
    const db = tx ?? this.prisma;
    const rows = await db.systemConfig.findMany({ where: { key: { in: keys } } });
    const out: Record<string, unknown> = {};
    for (const r of rows) out[r.key] = r.value;
    const missing = keys.filter((k) => !(k in out));
    if (missing.length) throw new Error(`Missing system_config keys: ${missing.join(', ')}`);
    return out;
  }

  async getInt(key: string, tx?: Tx): Promise<number> {
    const v = (await this.getMany([key], tx))[key];
    if (typeof v !== 'number' || !Number.isInteger(v)) throw new Error(`system_config ${key} is not an integer`);
    return v;
  }

  async getString(key: string, tx?: Tx): Promise<string> {
    return String((await this.getMany([key], tx))[key]);
  }

  list() {
    return this.prisma.systemConfig.findMany({ orderBy: [{ category: 'asc' }, { key: 'asc' }] });
  }

  async update(ctx: RequestContext, key: string, value: unknown, reason?: string) {
    return this.prisma.withContext(ctx, async (tx) => {
      const row = await tx.systemConfig.findUnique({ where: { key } });
      if (!row) throw new NotFoundException(`Unknown config key ${key}`);
      validateType(row.valueType, value);
      const updated = await tx.systemConfig.update({
        where: { key },
        data: { value: value as Prisma.InputJsonValue, updatedById: ctx.userId },
      });
      await this.audit.record(tx, ctx, {
        action: 'system_config.update',
        entityType: 'system_config',
        entityId: key,
        before: { value: row.value },
        after: { value: updated.value },
        reason,
      });
      return updated;
    });
  }
}

function validateType(type: string, value: unknown) {
  const ok =
    (type === 'int' && typeof value === 'number' && Number.isInteger(value)) ||
    (type === 'bool' && typeof value === 'boolean') ||
    (type === 'string' && typeof value === 'string') ||
    (type === 'json' && value !== undefined);
  if (!ok) throw new BadRequestException(`Value must be of type ${type}${type === 'int' ? ' (integer, money in piastres)' : ''}`);
}
