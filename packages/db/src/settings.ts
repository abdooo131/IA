import { GLOBAL_SCOPE, SETTING_DEFINITIONS, type SettingKey } from '@shiplynow/shared';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';

/**
 * Reads a setting: the dark store override if there is one, then the global value, then
 * the built in default. Stored values that fail validation are ignored, never trusted.
 */
export async function getSetting(db: Db, key: SettingKey, darkStoreId?: string): Promise<number> {
  const def = SETTING_DEFINITIONS[key];
  const scopes = darkStoreId ? [darkStoreId, GLOBAL_SCOPE] : [GLOBAL_SCOPE];
  const rows = await db.setting.findMany({ where: { key, scope: { in: scopes } } });
  for (const scope of scopes) {
    const row = rows.find((r) => r.scope === scope);
    const parsed = row && def.schema.safeParse(row.value);
    if (parsed?.success) return parsed.data;
  }
  return def.default;
}

/** Writes a setting and audits it. Throws if the value does not fit the setting. */
export async function setSetting(
  db: Db,
  input: { key: SettingKey; value: number; scope?: string; actorUserId: string | null },
) {
  const def = SETTING_DEFINITIONS[input.key];
  const value = def.schema.parse(input.value);
  const scope = input.scope ?? GLOBAL_SCOPE;
  return inTransaction(db, async (tx) => {
    const before = await tx.setting.findUnique({ where: { key_scope: { key: input.key, scope } } });
    const after = await tx.setting.upsert({
      where: { key_scope: { key: input.key, scope } },
      create: {
        key: input.key,
        scope,
        value,
        description: def.description,
        updatedById: input.actorUserId,
      },
      update: { value, updatedById: input.actorUserId },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'settings.update',
      entityType: 'setting',
      entityId: `${input.key}@${scope}`,
      before: before ? { value: before.value as number } : null,
      after: { value },
    });
    return after;
  });
}
