import { Injectable } from '@nestjs/common';
import { SETTINGS, defaultSettings, type SettingKey, type SettingValues } from '@shiply/shared';
import { PrismaService, type Tx } from './prisma.service';
import { DomainError } from './errors';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async all(db: Tx | PrismaService = this.prisma): Promise<SettingValues> {
    const rows = await db.setting.findMany();
    const values = defaultSettings() as Record<string, unknown>;
    for (const row of rows) if (row.key in SETTINGS) values[row.key] = row.value;
    return values as SettingValues;
  }

  async update(key: string, value: unknown) {
    if (!(key in SETTINGS)) throw new DomainError('invalid_input', `Unknown setting ${key}`, 422);
    const def = SETTINGS[key as SettingKey];
    const ok =
      (def.kind === 'time' && typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)) ||
      (def.kind === 'text' && typeof value === 'string' && /^[A-Z]{2,5}$/.test(value)) ||
      (['int', 'money', 'bp'].includes(def.kind) && Number.isInteger(value) && (value as number) >= 0 &&
        (def.kind !== 'bp' || (value as number) <= 10000)) ||
      (def.kind === 'choice' && typeof value === 'string' && ((def as { options?: readonly string[] }).options ?? []).includes(value)) ||
      (def.kind === 'date' && typeof value === 'string' && (value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value))) ||
      (def.kind === 'longtext' && typeof value === 'string' && value.length <= 300) ||
      (def.kind === 'weekdays' && Array.isArray(value) && value.length < 7 &&
        value.every((d) => Number.isInteger(d) && d >= 0 && d <= 6));
    if (!ok) throw new DomainError('invalid_input', `Bad value for ${def.label}`, 422);
    await this.prisma.setting.upsert({ where: { key }, update: { value: value as never }, create: { key, value: value as never } });
  }
}
