import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient, Tx } from '@shiply/db';
import { DB } from '../tokens';

/** Default values for every setting. Business values never live in code anywhere else. */
export const SETTING_DEFAULTS: Record<string, unknown> = {
  'auth.max_failed_logins': 5,
  'auth.lockout_minutes': 15,
  'auth.session_minutes': 15,
  'auth.refresh_days': 30,
  'events.retry_minutes': [1, 5, 30, 120],
};

@Injectable()
export class SettingsService {
  constructor(@Inject(DB) private readonly db: PrismaClient) {}

  async get<T>(key: string): Promise<T> {
    const row = await this.db.setting.findUnique({ where: { key } });
    if (row) return row.value as T;
    if (!(key in SETTING_DEFAULTS)) throw new Error(`Unknown setting ${key}`);
    return SETTING_DEFAULTS[key] as T;
  }

  async set(tx: Tx, key: string, value: unknown, userId: string) {
    return tx.setting.upsert({
      where: { key },
      update: { value: value as never, updatedBy: userId },
      create: { key, value: value as never, updatedBy: userId },
    });
  }
}
