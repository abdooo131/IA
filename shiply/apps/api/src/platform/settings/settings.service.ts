import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { PrismaClient, Tx } from '@shiply/db';
import { DB } from '../tokens';

/** Default values for every setting. Business values never live in code anywhere else. */
export const SETTING_DEFAULTS: Record<string, unknown> = {
  'parcels.bag_capacity': 150,
  'agents.expiry_warning_days': 30,
  'parcels.stuck_minutes': 60,
  'auth.max_failed_logins': 5,
  'auth.lockout_minutes': 15,
  'auth.session_minutes': 15,
  'auth.refresh_days': 30,
  'events.retry_minutes': [1, 5, 30, 120],
  'location.geocoder_enabled': false,
  'location.geocoder_monthly_cap': 5000,
  'money.vat_rate_bp': 1400,
};

const minutes = z.number().int();
/** What each setting accepts, so a typo can never lock everybody out. */
export const SETTING_SCHEMAS: Record<string, z.ZodTypeAny> = {
  'parcels.bag_capacity': z.number().int().min(1).max(1000),
  'agents.expiry_warning_days': z.number().int().min(1).max(180),
  'parcels.stuck_minutes': z.number().int().min(5).max(1440),
  'auth.max_failed_logins': z.number().int().min(3).max(20),
  'auth.lockout_minutes': minutes.min(1).max(1440),
  'auth.session_minutes': minutes.min(5).max(720),
  'auth.refresh_days': z.number().int().min(1).max(90),
  'events.retry_minutes': z.array(minutes.min(1).max(10080)).min(1).max(10),
  'location.geocoder_enabled': z.boolean(),
  'location.geocoder_monthly_cap': z.number().int().min(0).max(100000),
  'money.vat_rate_bp': z.number().int().min(0).max(5000),
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
