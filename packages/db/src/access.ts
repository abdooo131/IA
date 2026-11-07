import type { Prisma, Role } from '@prisma/client';
import {
  type AccessProfile,
  type AccessTemplate,
  accessFromBody,
  canDo,
  type CreateTeamMemberBody,
  isTeamRole,
  JOB_ROLE_TEMPLATES,
  type JobRole,
  type JobRoleLabel,
  type MerchantTeamRole,
  merchantRightsOf,
  NO_ACCESS,
  type SetAccessBody,
  type UpdateTeamMemberBody,
} from '@shiplynow/shared';
import { recordAudit } from './audit';
import { type Db, inTransaction } from './client';
import { DomainError } from './domain-error';
import { mapUnique } from './admin-ops';
import { hashPassword } from './password';

// Access rights (docs/ACCESS.md). Team members (admin, finance, store staff accounts) have a
// profile with a level per app and the stores they work in; merchant users are owners or
// members with a list of rights. Every change is audited with before and after.

type Tx = Prisma.TransactionClient;

const accessInclude = {
  access: true,
  accessStores: { select: { darkStoreId: true } },
  merchantsManaged: { select: { id: true } },
} as const;

function toProfile(
  row: Prisma.UserAccessGetPayload<object> | null,
  storeIds: string[],
  merchantIds: string[] = [],
): AccessProfile {
  if (!row) return { ...NO_ACCESS, storeIds };
  return {
    jobRole: row.jobRole as JobRoleLabel,
    store: row.store,
    operations: row.operations,
    inventory: row.inventory,
    merchants: row.merchants,
    customers: row.customers,
    accounting: row.accounting,
    hr: row.hr,
    sales: row.sales,
    settings: row.settings,
    allStores: row.allStores,
    customerData: row.customerData,
    salaries: row.salaries,
    ownMerchantsOnly: row.ownMerchantsOnly,
    ownDealsOnly: row.ownDealsOnly,
    storeIds: [...storeIds].sort(),
    merchantIds: row.ownMerchantsOnly ? [...merchantIds].sort() : [],
  };
}

/**
 * The access profile of a team member, read fresh. Null for riders, merchants and unknown or
 * disabled users; a team member without a profile row gets one that opens nothing.
 */
export async function getAccessProfile(db: Db, userId: string): Promise<AccessProfile | null> {
  const user = await db.user.findUnique({ where: { id: userId }, include: accessInclude });
  if (!user || !user.isActive || !isTeamRole(user.role)) return null;
  return toProfile(
    user.access,
    user.accessStores.map((s) => s.darkStoreId),
    user.merchantsManaged.map((m) => m.id),
  );
}

/** A team member's profile with their store names, for the access screens. */
export async function getUserAccess(db: Db, userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      access: true,
      accessStores: {
        select: { darkStore: { select: { id: true, code: true, nameEn: true, nameAr: true } } },
      },
      merchantsManaged: { select: { id: true } },
    },
  });
  if (!user) throw new DomainError('user_not_found', 404);
  if (!isTeamRole(user.role)) throw new DomainError('not_team_member', 400);
  const stores = user.accessStores
    .map((s) => s.darkStore)
    .sort((a, b) => a.code.localeCompare(b.code));
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
    },
    profile: toProfile(
      user.access,
      stores.map((s) => s.id),
      user.merchantsManaged.map((m) => m.id),
    ),
    stores,
  };
}

/** Serializes changes to who holds settings manage so two changes cannot both remove the last one. */
async function lockOwners(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('access_owners'))`;
}

/** At least one active team member other than `userId` keeps settings manage, or last_owner. */
async function assertAnotherOwner(tx: Tx, userId: string) {
  const others = await tx.userAccess.count({
    where: {
      settings: 'manage',
      userId: { not: userId },
      user: { isActive: true, role: { in: ['admin', 'finance', 'store_staff'] } },
    },
  });
  if (others === 0) throw new DomainError('last_owner', 409);
}

/** Called before a team member is disabled: the last person with settings manage cannot be. */
export async function assertCanDisable(tx: Tx, userId: string) {
  await lockOwners(tx);
  const row = await tx.userAccess.findUnique({ where: { userId } });
  if (row?.settings === 'manage') await assertAnotherOwner(tx, userId);
}

async function checkStores(tx: Tx, storeIds: string[]) {
  if (storeIds.length === 0) return;
  const found = await tx.darkStore.count({ where: { id: { in: storeIds } } });
  if (found !== storeIds.length) throw new DomainError('dark_store_not_found', 404);
}

function snapshot(profile: AccessProfile) {
  return { ...profile } as unknown as Prisma.InputJsonValue;
}

/** Writes a profile row and its stores. Used by setUserAccess, createUser and the seed. */
export async function writeAccess(
  tx: Tx,
  userId: string,
  values: AccessTemplate & { jobRole: JobRoleLabel },
  storeIds: string[],
) {
  const unique = [...new Set(storeIds)];
  if (!values.allStores && unique.length === 0) throw new DomainError('stores_required', 400);
  await checkStores(tx, unique);
  const data = {
    jobRole: values.jobRole,
    store: values.store,
    operations: values.operations,
    inventory: values.inventory,
    merchants: values.merchants,
    customers: values.customers,
    accounting: values.accounting,
    hr: values.hr,
    sales: values.sales,
    settings: values.settings,
    allStores: values.allStores,
    customerData: values.customerData,
    salaries: values.salaries,
    ownMerchantsOnly: values.ownMerchantsOnly,
    ownDealsOnly: values.ownDealsOnly,
  };
  await tx.userAccess.upsert({ where: { userId }, update: data, create: { userId, ...data } });
  await tx.userStore.deleteMany({ where: { userId } });
  // With every store the list is not used; it is kept empty so nothing stale lingers.
  if (!values.allStores && unique.length > 0)
    await tx.userStore.createMany({ data: unique.map((darkStoreId) => ({ userId, darkStoreId })) });
  const managed = data.ownMerchantsOnly
    ? await tx.merchant.findMany({ where: { accountManagerId: userId }, select: { id: true } })
    : [];
  return toProfile(
    { ...data, userId, updatedAt: new Date() },
    values.allStores ? [] : unique,
    managed.map((m) => m.id),
  );
}

/**
 * Sets a team member's access from a job role or custom values. Only a person with settings
 * manage may do it, never on themselves, and someone active must keep settings manage.
 */
export function setUserAccess(
  db: Db,
  input: { userId: string; body: SetAccessBody; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const actor = await getAccessProfile(tx, input.actorUserId);
    if (!canDo(actor, 'settings', 'manage')) throw new DomainError('no_access', 403);
    if (input.userId === input.actorUserId) throw new DomainError('cannot_change_own_access', 403);
    const user = await tx.user.findUnique({ where: { id: input.userId }, include: accessInclude });
    if (!user) throw new DomainError('user_not_found', 404);
    if (!isTeamRole(user.role)) throw new DomainError('not_team_member', 400);

    await lockOwners(tx);
    const before = toProfile(
      user.access,
      user.accessStores.map((s) => s.darkStoreId),
      user.merchantsManaged.map((m) => m.id),
    );
    const values = accessFromBody(input.body);
    if (before.settings === 'manage' && values.settings !== 'manage')
      await assertAnotherOwner(tx, user.id);
    const storeIds =
      input.body.storeIds ??
      (before.storeIds.length > 0 ? before.storeIds : user.darkStoreId ? [user.darkStoreId] : []);
    const after = await writeAccess(tx, user.id, values, storeIds);
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'user.access',
      entityType: 'user',
      entityId: user.id,
      before: user.access ? snapshot(before) : null,
      after: snapshot(after),
    });
    return after;
  });
}

/** The profile a new team member starts with when no job role is given (docs/ACCESS.md). */
export function defaultJobRole(
  role: Role,
  financeLevel?: 'view' | 'prepare' | 'approve',
): JobRole | null {
  if (role === 'admin') return 'operations_manager';
  if (role === 'store_staff') return 'store_staff';
  if (role === 'finance') {
    if (financeLevel === 'approve') return 'finance_manager';
    if (financeLevel === 'view') return 'accountant';
    return 'finance_officer';
  }
  return null;
}

/** Creates the profile of a team member just created (inside createUser's transaction). */
export async function createAccessFor(
  tx: Tx,
  user: { id: string; role: Role; darkStoreId: string | null },
  options: {
    jobRole?: JobRole;
    storeIds?: string[];
    financeLevel?: 'view' | 'prepare' | 'approve';
  },
) {
  const jobRole = options.jobRole ?? defaultJobRole(user.role, options.financeLevel);
  if (!jobRole || !isTeamRole(user.role)) return null;
  const storeIds = options.storeIds ?? (user.darkStoreId ? [user.darkStoreId] : []);
  return writeAccess(tx, user.id, { ...JOB_ROLE_TEMPLATES[jobRole], jobRole }, storeIds);
}

/** The finance level the older screens show, from the accounting level. */
export function financeLevelOf(accounting: AccessProfile['accounting']) {
  return accounting === 'manage' ? 'approve' : accounting === 'use' ? 'prepare' : 'view';
}

// ─── merchant team ─────────────────────────────────────────────────────────────

/** A merchant user's role and rights (owners have every right), or null if not a merchant. */
export async function getMerchantAccess(db: Db, userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      merchantId: true,
      merchantRole: true,
      merchantRights: true,
      isActive: true,
    },
  });
  if (!user || user.role !== 'merchant' || !user.merchantId) return null;
  const merchantRole: MerchantTeamRole = user.merchantRole ?? 'owner';
  return {
    merchantId: user.merchantId,
    merchantRole,
    rights: merchantRightsOf({ merchantRole, merchantRights: user.merchantRights }),
  };
}

function teamRow(u: {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  isActive: boolean;
  merchantRole: MerchantTeamRole | null;
  merchantRights: string[];
  createdAt: Date;
}) {
  const merchantRole: MerchantTeamRole = u.merchantRole ?? 'owner';
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    isActive: u.isActive,
    merchantRole,
    merchantRights: merchantRightsOf({ merchantRole, merchantRights: u.merchantRights }),
    createdAt: u.createdAt,
  };
}

export async function listMerchantTeam(db: Db, merchantId: string) {
  const users = await db.user.findMany({
    where: { merchantId, role: 'merchant' },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });
  return users.map(teamRow);
}

/** The owner acting on their team: must be an active owner of this merchant. */
async function ownerOf(tx: Tx, actorUserId: string) {
  const actor = await getMerchantAccess(tx, actorUserId);
  if (!actor || actor.merchantRole !== 'owner') throw new DomainError('owner_only', 403);
  return actor;
}

async function lockMerchantTeam(tx: Tx, merchantId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'merchant_team:' + merchantId}))`;
}

export function createMerchantTeamUser(
  db: Db,
  input: CreateTeamMemberBody & { actorUserId: string },
) {
  return mapUnique(async () => {
    const passwordHash = await hashPassword(input.password);
    return inTransaction(db, async (tx) => {
      const actor = await ownerOf(tx, input.actorUserId);
      const user = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          phone: input.phone ?? null,
          role: 'merchant',
          merchantId: actor.merchantId,
          passwordHash,
          merchantRole: input.merchantRole,
          merchantRights: input.merchantRole === 'member' ? input.merchantRights : [],
        },
      });
      await recordAudit(tx, {
        actorUserId: input.actorUserId,
        action: 'merchant_team.create',
        entityType: 'user',
        entityId: user.id,
        after: teamRow(user) as unknown as Prisma.InputJsonValue,
      });
      return teamRow(user);
    });
  });
}

/**
 * Changes a team member's role, rights or active state. An owner cannot lower or disable
 * themselves, and the merchant always keeps one active owner.
 */
export function updateMerchantTeamUser(
  db: Db,
  input: UpdateTeamMemberBody & { userId: string; actorUserId: string },
) {
  return inTransaction(db, async (tx) => {
    const actor = await ownerOf(tx, input.actorUserId);
    await lockMerchantTeam(tx, actor.merchantId);
    const before = await tx.user.findUnique({ where: { id: input.userId } });
    if (!before || before.role !== 'merchant' || before.merchantId !== actor.merchantId)
      throw new DomainError('user_not_found', 404);
    const merchantRole: MerchantTeamRole =
      input.merchantRole ?? before.merchantRole ?? ('owner' as const);
    const isActive = input.isActive ?? before.isActive;
    const wasOwner = (before.merchantRole ?? 'owner') === 'owner' && before.isActive;
    const staysOwner = merchantRole === 'owner' && isActive;
    if (before.id === input.actorUserId && !staysOwner)
      throw new DomainError('cannot_remove_self', 403);
    if (wasOwner && !staysOwner) {
      const owners = await tx.user.count({
        where: {
          merchantId: actor.merchantId,
          role: 'merchant',
          isActive: true,
          id: { not: before.id },
          OR: [{ merchantRole: 'owner' }, { merchantRole: null }],
        },
      });
      if (owners === 0) throw new DomainError('last_owner', 409);
    }
    const user = await tx.user.update({
      where: { id: before.id },
      data: {
        name: input.name,
        isActive,
        merchantRole,
        merchantRights:
          merchantRole === 'owner' ? [] : (input.merchantRights ?? before.merchantRights),
      },
    });
    if (before.isActive && !isActive)
      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'merchant_team.update',
      entityType: 'user',
      entityId: user.id,
      before: teamRow(before) as unknown as Prisma.InputJsonValue,
      after: teamRow(user) as unknown as Prisma.InputJsonValue,
    });
    return teamRow(user);
  });
}

export async function resetMerchantTeamPassword(
  db: Db,
  input: { userId: string; password: string; actorUserId: string },
) {
  const passwordHash = await hashPassword(input.password);
  return inTransaction(db, async (tx) => {
    const actor = await ownerOf(tx, input.actorUserId);
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user || user.role !== 'merchant' || user.merchantId !== actor.merchantId)
      throw new DomainError('user_not_found', 404);
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
    await tx.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await recordAudit(tx, {
      actorUserId: input.actorUserId,
      action: 'merchant_team.reset_password',
      entityType: 'user',
      entityId: user.id,
    });
    return { reset: true };
  });
}
