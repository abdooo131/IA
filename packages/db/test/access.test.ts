import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createMerchantTeamUser,
  getAccessProfile,
  getMerchantAccess,
  listMerchantTeam,
  resetMerchantTeamPassword,
  setUserAccess,
  updateMerchantTeamUser,
  writeAccess,
} from '../src/access';
import { createUser, updateUser } from '../src/admin-ops';
import { JOB_ROLE_TEMPLATES } from '@shiplynow/shared';
import { createFixture, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let owner: string;

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  owner = (
    await prisma.user.create({
      data: { email: 'owner@t.eg', name: 'Owner', role: 'admin', passwordHash: 'x' },
    })
  ).id;
  await prisma.$transaction((tx) =>
    writeAccess(tx, owner, { ...JOB_ROLE_TEMPLATES.owner, jobRole: 'owner' }, []),
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

const password = 'long-password-1';

describe('team access', () => {
  it('gives new team members a default job role', async () => {
    const ops = await createUser(prisma, {
      email: 'ops@t.eg',
      name: 'Ops',
      role: 'admin',
      password,
      actorUserId: owner,
    });
    expect(await getAccessProfile(prisma, ops.id)).toMatchObject({
      jobRole: 'operations_manager',
      settings: 'none',
      allStores: true,
    });
    const fin = await createUser(prisma, {
      email: 'fin@t.eg',
      name: 'Fin',
      role: 'finance',
      password,
      actorUserId: owner,
    });
    expect(await getAccessProfile(prisma, fin.id)).toMatchObject({
      jobRole: 'finance_officer',
      accounting: 'use',
    });
    const staff = await createUser(prisma, {
      email: 'staff@t.eg',
      name: 'Staff',
      role: 'store_staff',
      darkStoreId: f.store.id,
      password,
      actorUserId: owner,
    });
    expect(await getAccessProfile(prisma, staff.id)).toMatchObject({
      jobRole: 'store_staff',
      store: 'use',
      allStores: false,
      storeIds: [f.store.id],
    });
    const lead = await createUser(prisma, {
      email: 'lead@t.eg',
      name: 'Lead',
      role: 'admin',
      jobRole: 'store_manager',
      storeIds: [f.store.id, f.other.id],
      password,
      actorUserId: owner,
    });
    expect((await getAccessProfile(prisma, lead.id))?.storeIds).toHaveLength(2);
  });

  it('sets access from a job role or custom values, audited', async () => {
    const staff = await createUser(prisma, {
      email: 'staff@t.eg',
      name: 'Staff',
      role: 'store_staff',
      darkStoreId: f.store.id,
      password,
      actorUserId: owner,
    });
    await setUserAccess(prisma, {
      userId: staff.id,
      body: { jobRole: 'hub_staff', storeIds: [f.other.id] },
      actorUserId: owner,
    });
    expect(await getAccessProfile(prisma, staff.id)).toMatchObject({
      jobRole: 'hub_staff',
      inventory: 'view',
      storeIds: [f.other.id],
    });
    await setUserAccess(prisma, {
      userId: staff.id,
      body: {
        jobRole: 'custom',
        ...JOB_ROLE_TEMPLATES.hub_staff,
        operations: 'view',
      },
      actorUserId: owner,
    });
    expect(await getAccessProfile(prisma, staff.id)).toMatchObject({
      jobRole: 'custom',
      operations: 'view',
      storeIds: [f.other.id],
    });
    const audit = await prisma.auditLog.findMany({
      where: { action: 'user.access', entityId: staff.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit).toHaveLength(2);
    expect(audit[1]!.before).toMatchObject({ jobRole: 'hub_staff' });
    expect(audit[1]!.after).toMatchObject({ jobRole: 'custom', operations: 'view' });
  });

  it('needs settings manage, never on oneself, and keeps one owner', async () => {
    const ops = await createUser(prisma, {
      email: 'ops@t.eg',
      name: 'Ops',
      role: 'admin',
      password,
      actorUserId: owner,
    });
    await expect(
      setUserAccess(prisma, {
        userId: owner,
        body: { jobRole: 'accountant' },
        actorUserId: ops.id,
      }),
    ).rejects.toMatchObject({ code: 'no_access' });
    await expect(
      setUserAccess(prisma, { userId: owner, body: { jobRole: 'accountant' }, actorUserId: owner }),
    ).rejects.toMatchObject({ code: 'cannot_change_own_access' });
    await expect(
      setUserAccess(prisma, {
        userId: f.store.id,
        body: { jobRole: 'accountant' },
        actorUserId: owner,
      }),
    ).rejects.toMatchObject({ code: 'user_not_found' });

    // A second owner can lower the first only while someone keeps settings manage.
    await setUserAccess(prisma, { userId: ops.id, body: { jobRole: 'owner' }, actorUserId: owner });
    await setUserAccess(prisma, {
      userId: owner,
      body: { jobRole: 'accountant' },
      actorUserId: ops.id,
    });
    // ops is now the only one with settings manage: they cannot be disabled.
    await expect(
      updateUser(prisma, { userId: ops.id, isActive: false, actorUserId: owner }),
    ).rejects.toMatchObject({ code: 'last_owner' });
    // With two owners, one may be disabled.
    await prisma.userAccess.update({ where: { userId: owner }, data: { settings: 'manage' } });
    await updateUser(prisma, { userId: owner, isActive: false, actorUserId: ops.id });
  });

  it('refuses listed stores without a store', async () => {
    const ops = await createUser(prisma, {
      email: 'ops@t.eg',
      name: 'Ops',
      role: 'admin',
      password,
      actorUserId: owner,
    });
    await expect(
      setUserAccess(prisma, {
        userId: ops.id,
        body: { jobRole: 'store_manager' },
        actorUserId: owner,
      }),
    ).rejects.toMatchObject({ code: 'stores_required' });
  });

  it('opens nothing for disabled users and other roles', async () => {
    const rider = await prisma.user.create({
      data: { email: 'r@t.eg', name: 'R', role: 'rider', passwordHash: 'x' },
    });
    expect(await getAccessProfile(prisma, rider.id)).toBeNull();
    const bare = await prisma.user.create({
      data: { email: 'b@t.eg', name: 'B', role: 'admin', passwordHash: 'x' },
    });
    expect(await getAccessProfile(prisma, bare.id)).toMatchObject({
      settings: 'none',
      store: 'none',
    });
  });
});

describe('merchant team', () => {
  it('lets owners add members, change rights and keeps one active owner', async () => {
    const first = await createUser(prisma, {
      email: 'm@t.eg',
      name: 'Merchant',
      role: 'merchant',
      merchantId: f.merchant.id,
      password,
      actorUserId: owner,
    });
    expect(await getMerchantAccess(prisma, first.id)).toMatchObject({ merchantRole: 'owner' });
    const member = await createMerchantTeamUser(prisma, {
      email: 'mem@t.eg',
      name: 'Member',
      password,
      merchantRole: 'member',
      merchantRights: ['orders'],
      actorUserId: first.id,
    });
    expect(member.merchantRights).toEqual(['orders']);
    await expect(
      createMerchantTeamUser(prisma, {
        email: 'x@t.eg',
        name: 'X',
        password,
        merchantRole: 'member',
        merchantRights: [],
        actorUserId: member.id,
      }),
    ).rejects.toMatchObject({ code: 'owner_only' });

    await updateMerchantTeamUser(prisma, {
      userId: member.id,
      merchantRights: ['money', 'orders'],
      actorUserId: first.id,
    });
    expect((await getMerchantAccess(prisma, member.id))?.rights).toEqual(['orders', 'money']);

    await expect(
      updateMerchantTeamUser(prisma, { userId: first.id, isActive: false, actorUserId: first.id }),
    ).rejects.toMatchObject({ code: 'cannot_remove_self' });
    await expect(
      updateMerchantTeamUser(prisma, {
        userId: first.id,
        merchantRole: 'member',
        actorUserId: first.id,
      }),
    ).rejects.toMatchObject({ code: 'cannot_remove_self' });

    // A second owner may lower the first, but not the other way round once alone.
    await updateMerchantTeamUser(prisma, {
      userId: member.id,
      merchantRole: 'owner',
      actorUserId: first.id,
    });
    await updateMerchantTeamUser(prisma, {
      userId: first.id,
      merchantRole: 'member',
      actorUserId: member.id,
    });
    await expect(
      updateMerchantTeamUser(prisma, {
        userId: member.id,
        isActive: false,
        actorUserId: first.id,
      }),
    ).rejects.toMatchObject({ code: 'owner_only' });

    await resetMerchantTeamPassword(prisma, {
      userId: first.id,
      password: 'another-password-2',
      actorUserId: member.id,
    });
    const team = await listMerchantTeam(prisma, f.merchant.id);
    expect(team.map((u) => [u.email, u.merchantRole])).toEqual([
      ['mem@t.eg', 'owner'],
      ['m@t.eg', 'member'],
    ]);
    expect(
      await prisma.auditLog.count({ where: { action: { startsWith: 'merchant_team.' } } }),
    ).toBe(5);
  });

  it('keeps the last owner even when another owner acts', async () => {
    const a = await createUser(prisma, {
      email: 'a@m.eg',
      name: 'A',
      role: 'merchant',
      merchantId: f.merchant.id,
      password,
      actorUserId: owner,
    });
    const b = await createMerchantTeamUser(prisma, {
      email: 'b@m.eg',
      name: 'B',
      password,
      merchantRole: 'owner',
      merchantRights: [],
      actorUserId: a.id,
    });
    await updateMerchantTeamUser(prisma, { userId: b.id, isActive: false, actorUserId: a.id });
    const other = await prisma.merchant.create({ data: { name: 'Other' } });
    const stranger = await createUser(prisma, {
      email: 's@m.eg',
      name: 'S',
      role: 'merchant',
      merchantId: other.id,
      password,
      actorUserId: owner,
    });
    await expect(
      updateMerchantTeamUser(prisma, { userId: a.id, isActive: false, actorUserId: stranger.id }),
    ).rejects.toMatchObject({ code: 'user_not_found' });
  });
});
