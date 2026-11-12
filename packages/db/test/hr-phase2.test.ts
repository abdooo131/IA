import { addDays, cairoDay, type HireDraftData, JOB_ROLE_TEMPLATES } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getAccessProfile, writeAccess } from '../src/access';
import { createUser } from '../src/admin-ops';
import { readSetupToken, useSetupToken } from '../src/crm-proposals';
import { ensureDefaultAccounts, giveAdvance, recordCapital } from '../src/finance';
import { ensureHrDefaults } from '../src/hr-defaults';
import {
  confirmLeaving,
  leavingPreview,
  needsNewOwner,
  assignNewOwner,
  runExitDisables,
} from '../src/hr-exit';
import {
  addHireDraftFile,
  createHireFromDraft,
  type HireActor,
  issueEmployeeSetupLink,
  isNoLoginEmail,
  listHireDrafts,
  payPendingHires,
  requiredDocumentTypes,
  saveHireDraft,
  startHireDraft,
} from '../src/hr-hire';
import {
  documentsExpiring,
  myDocumentReminders,
  remindAllMissing,
  remindDocument,
} from '../src/hr-reminders';
import { setSalaryPackage } from '../src/hr-pay';
import { setSetting } from '../src/settings';
import { createFixture, prisma, resetDatabase } from './helpers';

// HR phase 2 (docs/HR.md "Phase 2 as built"): the new hire wizard, the leaving wizard and the
// easier documents (reminders, the expiry calendar).

let f: Awaited<ReturnType<typeof createFixture>>;
let owner: string;
let n = 0;
const key = () => `p2-${++n}-${Math.random().toString(36).slice(2)}`;
const today = cairoDay(new Date());
const PDF = Buffer.from('%PDF-1.4\n% scan\n');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);

async function actorOf(userId: string): Promise<HireActor> {
  const access = (await getAccessProfile(prisma, userId))!;
  return { userId, access, scope: access.allStores ? null : access.storeIds };
}

async function teamMember(email: string, jobRole: keyof typeof JOB_ROLE_TEMPLATES) {
  const u = await prisma.user.create({
    data: { email, name: email, role: 'admin', passwordHash: 'x' },
  });
  await prisma.$transaction((tx) =>
    writeAccess(tx, u.id, { ...JOB_ROLE_TEMPLATES[jobRole], jobRole }, [f.store.id]),
  );
  return u.id;
}

beforeEach(async () => {
  await resetDatabase();
  f = await createFixture();
  owner = await teamMember('owner@t.eg', 'owner');
  await ensureHrDefaults(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

const shift = () =>
  prisma.shift.create({
    data: { nameEn: 'Morning', startMinute: 540, endMinute: 1020, weekdays: [0, 1, 2, 3, 4, 6] },
  });

function pickerDraft(extra: Partial<HireDraftData> = {}): HireDraftData {
  return {
    person: {
      nameEn: 'Mona Adel',
      nameAr: 'منى عادل',
      mobile: '01012345678',
      email: 'mona@t.eg',
      nationalId: '29001011234567',
      birthDate: '1995-03-02',
      address: 'Maadi',
      emergencyName: 'Adel',
      emergencyPhone: '01112345678',
    },
    job: {
      kind: 'team',
      departmentId: 'dept_ops_ds',
      positionId: 'pos_picker',
      gradeId: 'grade_junior',
      storeIds: [f.store.id],
      hireDate: today,
      employment: 'employee',
      contractType: 'permanent',
    },
    pay: {
      basicPiastres: 900_000,
      insuredWagePiastres: 700_000,
      allowances: [{ kind: 'transport', amountPiastres: 50_000 }],
      iban: 'EG380019000500000000263180002',
      bankName: 'CIB',
    },
    access: {
      login: true,
      jobRole: 'store_staff',
      allStores: false,
      storeIds: [f.store.id],
      customerData: false,
      salaries: false,
    },
    ...extra,
  };
}

describe('new hire wizard', () => {
  it('creates login, access, file, pay, photo, documents, roster and onboarding in one go', async () => {
    const actor = await actorOf(owner);
    const morning = await shift();
    const data = pickerDraft();
    data.job.defaultShiftId = morning.id;
    const draft = await startHireDraft(prisma, { body: { step: 'person', data }, actor });
    expect((await listHireDrafts(prisma, actor)).map((d) => d.id)).toEqual([draft.id]);
    await saveHireDraft(prisma, { draftId: draft.id, body: { step: 'documents', data }, actor });
    await addHireDraftFile(prisma, {
      draftId: draft.id,
      kind: 'document',
      typeId: 'doctype_national_id',
      expiresOn: addDays(today, 2000),
      contentType: 'application/pdf',
      data: PDF,
      actor,
    });
    // An ID copy needs its expiry date, like any upload.
    await expect(
      addHireDraftFile(prisma, {
        draftId: draft.id,
        kind: 'document',
        typeId: 'doctype_national_id',
        contentType: 'application/pdf',
        data: PDF,
        actor,
      }),
    ).rejects.toThrow('expiry_required');
    await addHireDraftFile(prisma, {
      draftId: draft.id,
      kind: 'photo',
      contentType: 'image/jpeg',
      data: JPEG,
      actor,
    });

    const k = key();
    const made = await createHireFromDraft(prisma, { draftId: draft.id, idempotencyKey: k, actor });
    expect(made).toMatchObject({ code: expect.stringMatching(/^EMP-/), payPending: false });
    expect(made.setupToken).toEqual(expect.any(String));

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: made.userId },
      include: { access: true, accessStores: true },
    });
    expect(user).toMatchObject({
      email: 'mona@t.eg',
      phone: '+201012345678',
      role: 'store_staff',
      isActive: false,
      darkStoreId: f.store.id,
    });
    expect(user.access).toMatchObject({ jobRole: 'store_staff', store: 'use', hr: 'none' });
    expect(user.accessStores.map((s) => s.darkStoreId)).toEqual([f.store.id]);

    const e = await prisma.employee.findUniqueOrThrow({
      where: { id: made.employeeId },
      include: { salaryPackages: { include: { allowances: true } }, photo: true },
    });
    expect(e).toMatchObject({
      nameAr: 'منى عادل',
      positionId: 'pos_picker',
      departmentId: 'dept_ops_ds',
      homeStoreId: f.store.id,
      iban: 'EG380019000500000000263180002',
      defaultShiftId: morning.id,
    });
    expect(e.probationEndsOn).not.toBeNull();
    expect(e.photo).not.toBeNull();
    expect(e.salaryPackages).toHaveLength(1);
    expect(e.salaryPackages[0]!.effectiveFrom.toISOString().slice(0, 10)).toBe(today);
    expect(e.salaryPackages[0]!.allowances[0]!.amountPiastres).toBe(50_000);
    const docs = await prisma.employeeDocument.findMany({ where: { employeeId: e.id } });
    expect(docs.map((d) => [d.typeId, d.status])).toEqual([['doctype_national_id', 'verified']]);
    expect(await prisma.rosterDay.count({ where: { employeeId: e.id } })).toBe(14);
    const onboarding = await prisma.employeeChecklist.findFirstOrThrow({
      where: { employeeId: e.id, kind: 'onboarding' },
      include: { tasks: true },
    });
    expect(onboarding.templateId).toBe('chk_onboarding_store');
    // The ID task ticked itself from the verified document.
    expect(
      onboarding.tasks.find((t) => t.documentTypeId === 'doctype_national_id')!.doneAt,
    ).not.toBeNull();
    // Draft files are gone, the draft is done.
    expect(await prisma.hireDraftFile.count()).toBe(0);
    expect(await prisma.hireDraft.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({
      status: 'done',
      employeeId: e.id,
    });
    expect(await listHireDrafts(prisma, actor)).toEqual([]);
    const audit = await prisma.auditLog.findMany({
      where: { action: { in: ['employee.hire', 'user.create'] } },
    });
    expect(audit).toHaveLength(2);

    // A retry with the same key answers the same file without a new link.
    const again = await createHireFromDraft(prisma, {
      draftId: draft.id,
      idempotencyKey: k,
      actor,
    });
    expect(again).toMatchObject({ employeeId: e.id, setupToken: null, repeated: true });
    await expect(
      createHireFromDraft(prisma, { draftId: draft.id, idempotencyKey: key(), actor }),
    ).rejects.toThrow('draft_already_created');
    expect(await prisma.employee.count({ where: { nameEn: 'Mona Adel' } })).toBe(1);

    // The one time link opens the account; a new link stops the old one working.
    const second = await issueEmployeeSetupLink(prisma, {
      employeeId: e.id,
      actorUserId: owner,
      scope: null,
    });
    await expect(readSetupToken(prisma, made.setupToken!)).rejects.toThrow('setup_link_invalid');
    expect((await readSetupToken(prisma, second.setupToken)).email).toBe('mona@t.eg');
    await useSetupToken(prisma, second.setupToken, 'a-long-password-1');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: made.userId } })).isActive).toBe(
      true,
    );
    await expect(
      issueEmployeeSetupLink(prisma, { employeeId: e.id, actorUserId: owner, scope: null }),
    ).rejects.toThrow('login_already_active');
  });

  it('hires without a login and without pay (no salaries switch), flagged for an HR manager', async () => {
    const hr = await teamMember('hr@t.eg', 'hr_officer');
    const actor = await actorOf(hr);
    const data = pickerDraft({ pay: {}, access: { login: false } });
    data.person.email = undefined;
    const draft = await startHireDraft(prisma, { body: { step: 'person', data }, actor });
    // Pay needs the salaries switch.
    await expect(
      saveHireDraft(prisma, {
        draftId: draft.id,
        body: { step: 'pay', data: { ...data, pay: { basicPiastres: 1 } } },
        actor,
      }),
    ).rejects.toThrow('salaries_required');
    const made = await createHireFromDraft(prisma, {
      draftId: draft.id,
      idempotencyKey: key(),
      actor,
    });
    expect(made).toMatchObject({ setupToken: null, payPending: true });
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: made.userId },
      include: { access: true },
    });
    expect(isNoLoginEmail(user.email)).toBe(true);
    expect(user).toMatchObject({ isActive: false, role: 'admin', access: null });
    expect(await prisma.salaryPackage.count()).toBe(0);
    expect(await prisma.userSetupToken.count({ where: { userId: user.id } })).toBe(0);
    expect((await payPendingHires(prisma, null)).map((p) => p.id)).toEqual([made.employeeId]);
    await expect(
      issueEmployeeSetupLink(prisma, { employeeId: made.employeeId, actorUserId: hr, scope: null }),
    ).rejects.toThrow('no_login');
    // Once an HR manager adds the package it is no longer listed.
    await setSalaryPackage(prisma, {
      employeeId: made.employeeId,
      body: { basicPiastres: 800_000, allowances: [] },
      actorUserId: owner,
    });
    expect(await payPendingHires(prisma, null)).toEqual([]);
  });

  it('refuses an incomplete draft and access beyond what the HR person may give', async () => {
    const hr = await teamMember('hr@t.eg', 'hr_officer');
    const actor = await actorOf(hr);
    const empty = await startHireDraft(prisma, {
      body: { step: 'person', data: { person: { nameEn: 'X' }, job: {}, pay: {}, access: {} } },
      actor,
    });
    await expect(
      createHireFromDraft(prisma, { draftId: empty.id, idempotencyKey: key(), actor }),
    ).rejects.toThrow('draft_incomplete');
    const boss = pickerDraft({
      pay: {},
      access: { login: true, jobRole: 'owner', allStores: true, storeIds: [] },
    });
    boss.person.email = 'boss@t.eg';
    const draft = await startHireDraft(prisma, { body: { step: 'access', data: boss }, actor });
    await expect(
      createHireFromDraft(prisma, { draftId: draft.id, idempotencyKey: key(), actor }),
    ).rejects.toThrow('access_needs_settings');
    // Nothing was written by the refused create.
    expect(await prisma.user.count({ where: { email: 'boss@t.eg' } })).toBe(0);
  });

  it('lists the required documents by employment, department and position', async () => {
    const types = (p: Parameters<typeof requiredDocumentTypes>[1]) =>
      requiredDocumentTypes(prisma, p, { confidential: true }).then((all) =>
        all.filter((t) => t.required).map((t) => t.code),
      );
    const rider = await types({
      employment: 'employee',
      departmentId: null,
      positionId: 'pos_rider',
    });
    expect(rider).toEqual(
      expect.arrayContaining(['national_id', 'contract', 'criminal_record', 'driving_license']),
    );
    const outsourcedPicker = await types({
      employment: 'outsourced',
      departmentId: 'dept_ops_ds',
      positionId: 'pos_picker',
    });
    expect(outsourcedPicker).toContain('national_id');
    expect(outsourcedPicker).not.toContain('contract');
    expect(outsourcedPicker).not.toContain('driving_license');
  });
});

async function rider(nr: number) {
  const u = await createUser(prisma, {
    email: `rider${nr}@t.eg`,
    name: `Rider ${nr}`,
    role: 'rider',
    password: 'long-password-1',
    darkStoreId: f.store.id,
    badgeCode: `R-${nr}`,
    actorUserId: owner,
  });
  return prisma.employee.findUniqueOrThrow({ where: { userId: u.id } });
}

describe('leaving wizard', () => {
  it('sets left, starts offboarding, unassigns, and disables the account once after the last day', async () => {
    const leaverUser = await teamMember('lead@t.eg', 'sales_manager');
    const leader = await prisma.employee.create({
      data: { userId: leaverUser, nameEn: 'Lead', hireDate: new Date('2025-01-01T00:00:00Z') },
    });
    const one = await rider(1);
    const two = await rider(2);
    const nextBoss = await rider(3);
    await prisma.employee.updateMany({
      where: { id: { in: [one.id, two.id] } },
      data: { managerId: leader.id },
    });
    await prisma.department.update({
      where: { id: 'dept_com' },
      data: { headEmployeeId: leader.id },
    });
    await prisma.merchant.update({
      where: { id: f.merchant.id },
      data: { accountManagerId: leaverUser },
    });
    const company = await prisma.crmCompany.create({
      data: { brandName: 'Brand', source: 'manual', ownerId: leaverUser },
    });
    const deal = await prisma.crmDeal.create({
      data: { number: 1, companyId: company.id, ownerId: leaverUser },
    });
    const lastDay = addDays(today, 2);
    const preview = await leavingPreview(prisma, {
      employeeId: leader.id,
      lastDay,
      noticeGivenOn: addDays(today, -10),
      scope: null,
      pay: false,
      actorUserId: owner,
    });
    expect(preview.notice).toMatchObject({ days: 30, givenDays: 12, shortBy: 18 });
    expect(preview.owned.map((o) => o.kind).sort()).toEqual([
      'account_manager',
      'company_owner',
      'deal_owner',
      'department_head',
      'manager_of',
      'manager_of',
    ]);
    expect(preview.items.length).toBeGreaterThan(2);
    // Without the salaries switch the money is left out.
    expect(preview.settlement).toMatchObject({ money: false, netPiastres: null });

    const k = key();
    const body = {
      lastDay,
      reason: 'resignation' as const,
      noticeGivenOn: addDays(today, -10),
      itemsReturned: ['Take back the badge, uniform and devices'],
      replacements: [
        { kind: 'manager_of' as const, entityId: one.id, newOwnerId: nextBoss.id },
        { kind: 'deal_owner' as const, entityId: deal.id, newOwnerId: null },
      ],
      idempotencyKey: k,
    };
    const exit = await confirmLeaving(prisma, {
      employeeId: leader.id,
      body,
      actorUserId: owner,
      scope: null,
      pay: true,
    });
    expect(exit).toMatchObject({ lastDay, noticeShortBy: 18, disabledAt: null });
    expect(await prisma.employee.findUniqueOrThrow({ where: { id: leader.id } })).toMatchObject({
      status: 'left',
      leftReason: 'resignation',
    });
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: one.id } })).managerId).toBe(
      nextBoss.id,
    );
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: two.id } })).managerId).toBe(
      null,
    );
    expect((await prisma.crmDeal.findUniqueOrThrow({ where: { id: deal.id } })).ownerId).toBe(null);
    expect(
      (await prisma.merchant.findUniqueOrThrow({ where: { id: f.merchant.id } })).accountManagerId,
    ).toBe(null);
    const open = await needsNewOwner(prisma, null);
    expect(open.map((r) => r.kind).sort()).toEqual([
      'account_manager',
      'company_owner',
      'deal_owner',
      'department_head',
      'manager_of',
    ]);
    const offboarding = await prisma.employeeChecklist.findFirstOrThrow({
      where: { employeeId: leader.id, kind: 'offboarding' },
      include: { tasks: true },
    });
    expect(offboarding.tasks.filter((t) => t.doneAt).map((t) => t.titleEn)).toEqual([
      'Take back the badge, uniform and devices',
    ]);
    // Same key: the same exit, nothing twice.
    const again = await confirmLeaving(prisma, {
      employeeId: leader.id,
      body,
      actorUserId: owner,
      scope: null,
      pay: true,
    });
    expect(again.id).toBe(exit.id);
    expect(await prisma.employeeExit.count()).toBe(1);

    // HR gives the head job to someone later.
    const head = open.find((r) => r.kind === 'department_head')!;
    await assignNewOwner(prisma, {
      reassignmentId: head.id,
      newOwnerId: nextBoss.id,
      actorUserId: owner,
      scope: null,
    });
    expect(
      (await prisma.department.findUniqueOrThrow({ where: { id: 'dept_com' } })).headEmployeeId,
    ).toBe(nextBoss.id);
    await expect(
      assignNewOwner(prisma, {
        reassignmentId: head.id,
        newOwnerId: nextBoss.id,
        actorUserId: owner,
        scope: null,
      }),
    ).rejects.toThrow('already_reassigned');

    // The account stays open until the last day is over, then closes once.
    await prisma.refreshToken.create({
      data: {
        userId: leaverUser,
        tokenHash: 'h1',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    expect(await runExitDisables(prisma, new Date())).toEqual({ disabled: 0, cancelled: 0 });
    const after = new Date(Date.parse(`${addDays(lastDay, 1)}T00:00:00Z`) + 3_600_000);
    expect(await runExitDisables(prisma, after)).toEqual({ disabled: 1, cancelled: 0 });
    expect(await runExitDisables(prisma, after)).toEqual({ disabled: 0, cancelled: 0 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: leaverUser } })).isActive).toBe(
      false,
    );
    expect(
      (await prisma.refreshToken.findFirstOrThrow({ where: { userId: leaverUser } })).revokedAt,
    ).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'user.disable_on_exit' } })).toBe(1);
  });

  it('works out the settlement from leave, deductions, advances and commission', async () => {
    await ensureDefaultAccounts(prisma);
    const bank = await prisma.ledgerAccount.findUniqueOrThrow({ where: { key: 'bank' } });
    await recordCapital(prisma, {
      direction: 'in',
      moneyAccountId: bank.id,
      amountPiastres: 10_000_000,
      reference: 'Owner',
      actorUserId: owner,
      idempotencyKey: key(),
    });
    const userId = await teamMember('picker@t.eg', 'store_staff');
    const year = Number(today.slice(0, 4));
    const e = await prisma.employee.create({
      data: { userId, nameEn: 'Picker', hireDate: new Date(`${year - 1}-01-01T00:00:00Z`) },
    });
    await setSalaryPackage(prisma, {
      employeeId: e.id,
      body: { effectiveFrom: `${year - 1}-01-01`, basicPiastres: 900_000, allowances: [] },
      actorUserId: owner,
    });
    await setSetting(prisma, {
      key: 'hr.default_annual_leave_days',
      scope: 'global',
      value: 21,
      actorUserId: owner,
    });
    const type = await prisma.violationType.findFirstOrThrow();
    await prisma.violation.create({
      data: {
        employeeId: e.id,
        typeId: type.id,
        occurredOn: new Date(`${today}T00:00:00Z`),
        description: 'Late',
        suggestedStep: 1,
        step: 1,
        penalty: 'deduction_amount',
        amountPiastres: 20_000,
        status: 'final',
        finalAt: new Date(Date.now() - 3_600_000),
        recordedById: owner,
      },
    });
    await giveAdvance(prisma, {
      userId,
      amountPiastres: 30_000,
      moneyAccountId: bank.id,
      reference: 'Advance',
      actorUserId: owner,
      idempotencyKey: key(),
    });
    await prisma.crmCommission.create({
      data: {
        userId,
        month: '2026-10',
        status: 'draft',
        computedPiastres: 15_000,
        amountPiastres: 15_000,
        idempotencyKey: key(),
      },
    });
    const preview = await leavingPreview(prisma, {
      employeeId: e.id,
      lastDay: today,
      scope: null,
      pay: true,
      actorUserId: owner,
    });
    const s = preview.settlement as Record<string, number | null>;
    expect(s.money).toBe(true);
    expect(s.leaveDaysToPay).toBe(21);
    expect(s.leavePayPiastres).toBe(630_000);
    expect(s.deductionsPiastres).toBe(20_000);
    expect(s.advancePiastres).toBe(30_000);
    expect(s.commissionPiastres).toBe(15_000);
    expect(s.daysWorked).toBe(Number(today.slice(8, 10)));

    // Unused leave is not paid when the setting says so.
    await setSetting(prisma, {
      key: 'hr.pay_unused_leave_on_exit',
      scope: 'global',
      value: 0,
      actorUserId: owner,
    });
    const unpaid = await leavingPreview(prisma, {
      employeeId: e.id,
      lastDay: today,
      scope: null,
      pay: true,
      actorUserId: owner,
    });
    expect((unpaid.settlement as Record<string, number>).leavePayPiastres).toBe(0);
  });
});

describe('easier documents', () => {
  it('reminds once per type and day, shows it in My HR and on the expiry calendar', async () => {
    const r = await rider(1);
    const first = await remindDocument(prisma, {
      employeeId: r.id,
      typeId: 'doctype_driving_license',
      actorUserId: owner,
      scope: null,
      confidential: true,
    });
    expect(first).toEqual({ sent: true, alreadyToday: false });
    expect(
      await remindDocument(prisma, {
        employeeId: r.id,
        typeId: 'doctype_driving_license',
        actorUserId: owner,
        scope: null,
        confidential: true,
      }),
    ).toEqual({ sent: false, alreadyToday: true });
    const all = await remindAllMissing(prisma, {
      employeeId: r.id,
      actorUserId: owner,
      scope: null,
      confidential: true,
    });
    expect(all.total).toBeGreaterThan(1);
    expect(all.alreadyToday).toBe(1);
    const mine = await myDocumentReminders(prisma, r.userId);
    expect(mine.map((m) => m.type.id)).toContain('doctype_driving_license');

    // A verified document needs no reminder.
    await prisma.employeeDocument.create({
      data: {
        employeeId: r.id,
        typeId: 'doctype_national_id',
        contentType: 'application/pdf',
        data: new Uint8Array(PDF),
        sizeBytes: PDF.length,
        expiresOn: new Date(`${addDays(today, 400)}T00:00:00Z`),
        status: 'verified',
        reviewedById: owner,
        reviewedAt: new Date(),
        uploadedById: owner,
      },
    });
    await expect(
      remindDocument(prisma, {
        employeeId: r.id,
        typeId: 'doctype_national_id',
        actorUserId: owner,
        scope: null,
        confidential: true,
      }),
    ).rejects.toThrow('document_in_order');
    const calendar = await documentsExpiring(prisma, {
      month: addDays(today, 400).slice(0, 7),
      scope: null,
      confidential: true,
    });
    expect(calendar.items.map((i) => i.employee.id)).toEqual([r.id]);
    expect(
      (
        await documentsExpiring(prisma, {
          month: addDays(today, 400).slice(0, 7),
          scope: ['x'],
          confidential: true,
        })
      ).items,
    ).toEqual([]);
  });
});
