import { Prisma, type Role } from '@prisma/client';
import {
  type CreateUserBody,
  GLOBAL_SCOPE,
  type MerchantBody,
  merchantScope,
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  type SettingKey,
  type SkuBody,
  type SkuImportRow,
  type UpdateSkuBody,
  type UpdateUserBody,
} from '@shiplynow/shared';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';

type Tx = Prisma.TransactionClient;
import { DomainError } from './domain-error';
import { hashPassword } from './password';
import { setSetting } from './settings';

type Actor = string;

// ─── users ─────────────────────────────────────────────────────────────────────

/** What a user record looks like in audit rows: never the password hash. */
function userSnapshot(u: {
  email: string;
  name: string;
  phone: string | null;
  role: Role;
  isActive: boolean;
  darkStoreId: string | null;
  merchantId: string | null;
}) {
  return {
    email: u.email,
    name: u.name,
    phone: u.phone,
    role: u.role,
    isActive: u.isActive,
    darkStoreId: u.darkStoreId,
    merchantId: u.merchantId,
  };
}

/** Each role needs its link: staff and riders a store, riders a badge, merchants a merchant. */
async function checkLinks(
  tx: Tx,
  role: Role,
  links: { darkStoreId: string | null; merchantId: string | null; badgeCode: string | null },
) {
  if ((role === 'store_staff' || role === 'rider') && !links.darkStoreId)
    throw new DomainError('dark_store_required', 400);
  if (role === 'rider' && !links.badgeCode) throw new DomainError('badge_required', 400);
  if (role === 'merchant' && !links.merchantId) throw new DomainError('merchant_required', 400);
  if (links.darkStoreId) {
    const store = await tx.darkStore.findUnique({ where: { id: links.darkStoreId } });
    if (!store) throw new DomainError('dark_store_not_found', 404);
  }
  if (links.merchantId) {
    const merchant = await tx.merchant.findUnique({ where: { id: links.merchantId } });
    if (!merchant) throw new DomainError('merchant_not_found', 404);
  }
}

function uniqueViolation(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const target = String((error.meta?.target as string[] | string | undefined) ?? '');
    if (target.includes('email')) return 'email_taken';
    if (target.includes('phone')) return 'phone_taken';
    if (target.includes('badge')) return 'badge_taken';
    if (target.includes('sku')) return 'sku_taken';
    if (target.includes('shopify')) return 'shopify_variant_taken';
    return 'already_exists';
  }
  return null;
}

export async function mapUnique<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const code = uniqueViolation(error);
    if (code) throw new DomainError(code, 409);
    throw error;
  }
}

export function createUser(db: Db, input: CreateUserBody & { actorUserId: Actor }) {
  return mapUnique(async () => {
    const passwordHash = await hashPassword(input.password);
    return inTransaction(db, async (tx) => {
      const links = {
        darkStoreId:
          input.role === 'store_staff' || input.role === 'rider'
            ? (input.darkStoreId ?? null)
            : null,
        merchantId: input.role === 'merchant' ? (input.merchantId ?? null) : null,
        badgeCode: input.role === 'rider' ? (input.badgeCode ?? null) : null,
      };
      await checkLinks(tx, input.role, links);
      const user = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          phone: input.phone ?? null,
          role: input.role,
          passwordHash,
          darkStoreId: links.darkStoreId,
          merchantId: links.merchantId,
        },
      });
      if (input.role === 'rider') {
        await tx.rider.create({
          data: { userId: user.id, darkStoreId: links.darkStoreId!, badgeCode: links.badgeCode! },
        });
      }
      await recordAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'user.create',
        entityType: 'user',
        entityId: user.id,
        after: { ...userSnapshot(user), badgeCode: links.badgeCode },
      });
      return user;
    });
  });
}

export function updateUser(db: Db, input: UpdateUserBody & { userId: string; actorUserId: Actor }) {
  return mapUnique(() =>
    inTransaction(db, async (tx) => {
      const before = await tx.user.findUnique({
        where: { id: input.userId },
        include: { rider: true },
      });
      if (!before) throw new DomainError('user_not_found', 404);
      if (input.userId === input.actorUserId && input.isActive === false)
        throw new DomainError('cannot_deactivate_self', 400);

      const darkStoreId = input.darkStoreId !== undefined ? input.darkStoreId : before.darkStoreId;
      const merchantId = input.merchantId !== undefined ? input.merchantId : before.merchantId;
      const badgeCode =
        input.badgeCode !== undefined ? input.badgeCode : (before.rider?.badgeCode ?? null);
      await checkLinks(tx, before.role, { darkStoreId, merchantId, badgeCode });

      if (before.role === 'rider' && before.rider && darkStoreId !== before.rider.darkStoreId) {
        const busy = await tx.delivery.count({
          where: { riderId: before.rider.id, status: { in: ['assigned', 'picked_up'] } },
        });
        if (busy > 0) throw new DomainError('rider_has_open_deliveries');
      }

      const user = await tx.user.update({
        where: { id: input.userId },
        data: {
          name: input.name,
          phone: input.phone,
          isActive: input.isActive,
          darkStoreId:
            before.role === 'store_staff' || before.role === 'rider' ? darkStoreId : null,
          merchantId: before.role === 'merchant' ? merchantId : null,
        },
      });
      if (before.role === 'rider' && before.rider) {
        await tx.rider.update({
          where: { id: before.rider.id },
          data: { darkStoreId: darkStoreId!, badgeCode: badgeCode! },
        });
      }
      // A deactivated user is signed out everywhere at once.
      if (input.isActive === false && before.isActive) {
        await tx.refreshToken.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await recordAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'user.update',
        entityType: 'user',
        entityId: user.id,
        before: { ...userSnapshot(before), badgeCode: before.rider?.badgeCode ?? null },
        after: {
          ...userSnapshot(user),
          badgeCode: before.role === 'rider' ? badgeCode : null,
        },
      });
      return user;
    }),
  );
}

export async function resetUserPassword(
  db: Db,
  input: { userId: string; password: string; actorUserId: Actor },
) {
  const passwordHash = await hashPassword(input.password);
  return inTransaction(db, async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user) throw new DomainError('user_not_found', 404);
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    await tx.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'user.reset_password',
      entityType: 'user',
      entityId: user.id,
    });
    return { reset: true };
  });
}

export async function listUsers(db: Db, filter: { role?: Role; q?: string } = {}) {
  const users = await db.user.findMany({
    where: {
      role: filter.role,
      OR: filter.q
        ? [
            { name: { contains: filter.q, mode: 'insensitive' } },
            { email: { contains: filter.q, mode: 'insensitive' } },
            { phone: { contains: filter.q } },
          ]
        : undefined,
    },
    include: {
      darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true } },
      merchant: { select: { id: true, name: true } },
      rider: { select: { badgeCode: true } },
    },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  });
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    role: u.role,
    isActive: u.isActive,
    darkStore: u.darkStore,
    merchant: u.merchant,
    badgeCode: u.rider?.badgeCode ?? null,
    createdAt: u.createdAt,
  }));
}

// ─── merchants ─────────────────────────────────────────────────────────────────

export function createMerchant(db: Db, input: MerchantBody & { actorUserId: Actor }) {
  return inTransaction(db, async (tx) => {
    const merchant = await tx.merchant.create({
      data: {
        name: input.name,
        contactEmail: input.contactEmail ?? null,
        contactPhone: input.contactPhone ?? null,
        isActive: input.isActive ?? true,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'merchant.create',
      entityType: 'merchant',
      entityId: merchant.id,
      after: {
        name: merchant.name,
        contactEmail: merchant.contactEmail,
        contactPhone: merchant.contactPhone,
      },
    });
    return merchant;
  });
}

export function updateMerchant(
  db: Db,
  input: Partial<MerchantBody> & { merchantId: string; actorUserId: Actor },
) {
  return inTransaction(db, async (tx) => {
    const before = await tx.merchant.findUnique({ where: { id: input.merchantId } });
    if (!before) throw new DomainError('merchant_not_found', 404);
    const after = await tx.merchant.update({
      where: { id: before.id },
      data: {
        name: input.name,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        isActive: input.isActive,
      },
    });
    const pick = (m: typeof before) => ({
      name: m.name,
      contactEmail: m.contactEmail,
      contactPhone: m.contactPhone,
      isActive: m.isActive,
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'merchant.update',
      entityType: 'merchant',
      entityId: before.id,
      before: pick(before),
      after: pick(after),
    });
    return after;
  });
}

// ─── products ──────────────────────────────────────────────────────────────────

const skuSnapshot = (s: {
  sku: string;
  barcode: string | null;
  titleEn: string;
  titleAr: string;
  pricePiastres: number;
  weightGrams: number | null;
  isActive: boolean;
}) => ({
  sku: s.sku,
  barcode: s.barcode,
  titleEn: s.titleEn,
  titleAr: s.titleAr,
  pricePiastres: s.pricePiastres,
  weightGrams: s.weightGrams,
  isActive: s.isActive,
});

/**
 * Barcodes are scanned in the store without knowing the merchant, so one barcode may
 * belong to only one product across the whole system.
 */
async function checkBarcode(tx: Tx, barcode: string | null | undefined, skuId?: string) {
  if (!barcode) return;
  const other = await tx.sku.findFirst({
    where: { barcode, id: skuId ? { not: skuId } : undefined },
  });
  if (other) throw new DomainError('barcode_taken');
}

export function createSku(db: Db, input: SkuBody & { actorUserId: Actor }) {
  return mapUnique(() =>
    inTransaction(db, async (tx) => {
      const merchant = await tx.merchant.findUnique({ where: { id: input.merchantId } });
      if (!merchant) throw new DomainError('merchant_not_found', 404);
      await checkBarcode(tx, input.barcode);
      const sku = await tx.sku.create({
        data: {
          merchantId: input.merchantId,
          sku: input.sku,
          barcode: input.barcode ?? null,
          titleEn: input.titleEn,
          titleAr: input.titleAr,
          pricePiastres: input.pricePiastres,
          weightGrams: input.weightGrams ?? null,
          isActive: input.isActive ?? true,
        },
      });
      await recordAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'sku.create',
        entityType: 'sku',
        entityId: sku.id,
        after: skuSnapshot(sku),
      });
      return sku;
    }),
  );
}

export function updateSku(db: Db, input: UpdateSkuBody & { skuId: string; actorUserId: Actor }) {
  return inTransaction(db, async (tx) => {
    const before = await tx.sku.findUnique({ where: { id: input.skuId } });
    if (!before) throw new DomainError('sku_not_found', 404);
    await checkBarcode(tx, input.barcode, before.id);
    const after = await tx.sku.update({
      where: { id: before.id },
      data: {
        barcode: input.barcode,
        titleEn: input.titleEn,
        titleAr: input.titleAr,
        pricePiastres: input.pricePiastres,
        weightGrams: input.weightGrams,
        isActive: input.isActive,
      },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'sku.update',
      entityType: 'sku',
      entityId: before.id,
      before: skuSnapshot(before),
      after: skuSnapshot(after),
    });
    return after;
  });
}

export interface SkuImportResult {
  created: number;
  updated: number;
  unchanged: number;
  errors: { row: number; sku?: string; error: string }[];
}

/**
 * Creates or updates a merchant's products by SKU code. All rows are checked first; if any
 * row is wrong nothing is written, so a file is applied completely or not at all.
 */
export function importSkus(
  db: Db,
  input: { merchantId: string; rows: { row: number; data: SkuImportRow }[]; actorUserId: Actor },
): Promise<SkuImportResult> {
  return inTransaction(db, async (tx) => {
    const merchant = await tx.merchant.findUnique({ where: { id: input.merchantId } });
    if (!merchant) throw new DomainError('merchant_not_found', 404);

    const errors: SkuImportResult['errors'] = [];
    const seenSku = new Map<string, number>();
    const seenBarcode = new Map<string, number>();
    for (const { row, data } of input.rows) {
      if (seenSku.has(data.sku))
        errors.push({ row, sku: data.sku, error: 'duplicate_sku_in_file' });
      seenSku.set(data.sku, row);
      if (data.barcode) {
        if (seenBarcode.has(data.barcode))
          errors.push({ row, sku: data.sku, error: 'duplicate_barcode_in_file' });
        seenBarcode.set(data.barcode, row);
      }
    }

    const existing = await tx.sku.findMany({ where: { merchantId: merchant.id } });
    const bySku = new Map(existing.map((s) => [s.sku, s]));
    const barcodes = [...seenBarcode.keys()];
    const holders = barcodes.length
      ? await tx.sku.findMany({ where: { barcode: { in: barcodes } } })
      : [];
    for (const { row, data } of input.rows) {
      const holder = data.barcode ? holders.find((h) => h.barcode === data.barcode) : undefined;
      if (holder && !(holder.merchantId === merchant.id && holder.sku === data.sku))
        errors.push({ row, sku: data.sku, error: 'barcode_taken' });
    }
    if (errors.length) return { created: 0, updated: 0, unchanged: 0, errors };

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    for (const { data } of input.rows) {
      const before = bySku.get(data.sku);
      if (!before) {
        const sku = await tx.sku.create({ data: { merchantId: merchant.id, ...data } });
        await recordAudit(tx, {
          actorUserId: input.actorUserId,
          action: 'sku.import_create',
          entityType: 'sku',
          entityId: sku.id,
          after: skuSnapshot(sku),
        });
        created++;
        continue;
      }
      const same =
        before.barcode === data.barcode &&
        before.titleEn === data.titleEn &&
        before.titleAr === data.titleAr &&
        before.pricePiastres === data.pricePiastres &&
        before.weightGrams === data.weightGrams;
      if (same) {
        unchanged++;
        continue;
      }
      const after = await tx.sku.update({ where: { id: before.id }, data });
      await recordAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'sku.import_update',
        entityType: 'sku',
        entityId: before.id,
        before: skuSnapshot(before),
        after: skuSnapshot(after),
      });
      updated++;
    }
    return { created, updated, unchanged, errors };
  });
}

// ─── settings ──────────────────────────────────────────────────────────────────

export async function listSettings(db: Db) {
  const [rows, stores, merchants] = await Promise.all([
    db.setting.findMany({ include: { updatedBy: { select: { name: true } } } }),
    db.darkStore.findMany({
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { code: 'asc' },
    }),
    db.merchant.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  return {
    stores,
    merchants,
    settings: SETTING_KEYS.map((key) => {
      const def = SETTING_DEFINITIONS[key];
      const valid = (value: unknown) => {
        const parsed = def.schema.safeParse(value);
        return parsed.success ? parsed.data : null;
      };
      const global = rows.find((r) => r.key === key && r.scope === GLOBAL_SCOPE);
      return {
        key,
        description: def.description,
        default: def.default,
        override: def.override,
        global: global ? valid(global.value) : null,
        globalUpdatedAt: global?.updatedAt ?? null,
        globalUpdatedBy: global?.updatedBy?.name ?? null,
        overrides: rows
          .filter((r) => r.key === key && r.scope !== GLOBAL_SCOPE)
          .map((r) => ({
            scope: r.scope,
            darkStoreId: r.scope.startsWith('merchant:') ? null : r.scope,
            merchantId: r.scope.startsWith('merchant:') ? r.scope.slice('merchant:'.length) : null,
            value: valid(r.value),
            updatedAt: r.updatedAt,
            updatedBy: r.updatedBy?.name ?? null,
          })),
      };
    }),
  };
}

/** Sets a value, or with value null removes a store override so the global value applies. */
export async function changeSetting(
  db: Db,
  input: { key: SettingKey; scope: string; value: number | null; actorUserId: Actor },
) {
  if (input.scope !== GLOBAL_SCOPE) {
    // Each setting allows one kind of override: per store (SLA, capacity) or per merchant (fees).
    const kind = SETTING_DEFINITIONS[input.key].override;
    if (input.scope.startsWith('merchant:')) {
      if (kind !== 'merchant') throw new DomainError('scope_not_allowed', 400);
      const id = input.scope.slice('merchant:'.length);
      const merchant = await db.merchant.findUnique({ where: { id } });
      if (!merchant || merchantScope(merchant.id) !== input.scope)
        throw new DomainError('merchant_not_found', 404);
    } else {
      if (kind !== 'store') throw new DomainError('scope_not_allowed', 400);
      const store = await db.darkStore.findUnique({ where: { id: input.scope } });
      if (!store) throw new DomainError('dark_store_not_found', 404);
    }
  }
  if (input.value !== null) {
    const parsed = SETTING_DEFINITIONS[input.key].schema.safeParse(input.value);
    if (!parsed.success) throw new DomainError('invalid_setting_value', 400);
    return setSetting(db, { ...input, value: parsed.data });
  }
  if (input.scope === GLOBAL_SCOPE) throw new DomainError('global_value_required', 400);
  return inTransaction(db, async (tx) => {
    const before = await tx.setting.findUnique({
      where: { key_scope: { key: input.key, scope: input.scope } },
    });
    if (!before) return null;
    await tx.setting.delete({ where: { key_scope: { key: input.key, scope: input.scope } } });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'settings.remove_override',
      entityType: 'setting',
      entityId: `${input.key}@${input.scope}`,
      before: { value: before.value as number },
    });
    return null;
  });
}

// ─── audit ─────────────────────────────────────────────────────────────────────

export interface AuditFilter {
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  action?: string;
  from?: Date;
  to?: Date;
  /** id of the last row of the previous page */
  cursor?: string;
  take?: number;
}

export async function listAudit(db: Db, filter: AuditFilter) {
  const take = Math.min(filter.take ?? 50, 200);
  const rows = await db.auditLog.findMany({
    where: {
      entityType: filter.entityType,
      entityId: filter.entityId,
      actorUserId: filter.actorUserId,
      action: filter.action ? { startsWith: filter.action } : undefined,
      createdAt: filter.from || filter.to ? { gte: filter.from, lt: filter.to } : undefined,
    },
    include: { actor: { select: { name: true, email: true, role: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: take + 1,
    cursor: filter.cursor ? { id: filter.cursor } : undefined,
    skip: filter.cursor ? 1 : 0,
  });
  const page = rows.slice(0, take);
  return {
    rows: page.map((r) => ({
      id: r.id,
      at: r.createdAt,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      actor: r.actor ? { name: r.actor.name, email: r.actor.email, role: r.actor.role } : null,
      before: r.before as unknown,
      after: r.after as unknown,
    })),
    nextCursor: rows.length > take ? page[page.length - 1]!.id : null,
  };
}
