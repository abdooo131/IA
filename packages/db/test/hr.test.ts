import { cairoDay, JOB_ROLE_TEMPLATES } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getAccessProfile, setUserAccess, writeAccess } from '../src/access';
import { createUser, updateUser } from '../src/admin-ops';
import { listStaffPay, setSalary } from '../src/finance/payroll';
import {
  addEmployeeDocument,
  checkDocumentExpiry,
  deleteEmployeeDocument,
  employeeHistory,
  ensureEmployees,
  getEmployee,
  listEmployeeDocuments,
  listEmployees,
  setAccountManager,
  setEmployeeStatus,
  updateEmployee,
} from '../src/hr';
import { createFixture, prisma, resetDatabase } from './helpers';

let f: Awaited<ReturnType<typeof createFixture>>;
let owner: string;
const password = 'long-password-1';
const today = cairoDay(new Date());
const PDF = Buffer.from('%PDF-1.4\n%test\n');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

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

async function rider() {
  const user = await createUser(prisma, {
    email: 'rider@t.eg',
    name: 'Rider One',
    role: 'rider',
    password,
    darkStoreId: f.store.id,
    badgeCode: 'R-1',
    phone: '+201012345678',
    actorUserId: owner,
  });
  const file = await prisma.employee.findUniqueOrThrow({ where: { userId: user.id } });
  return { user, file };
}

describe('employee files', () => {
  it('opens a file for every new team member and rider, never for merchants', async () => {
    const { user, file } = await rider();
    expect(file).toMatchObject({ nameEn: 'Rider One', homeStoreId: f.store.id, status: 'active' });
    expect(file.number).toBeGreaterThan(0);
    const merchantUser = await createUser(prisma, {
      email: 'm@t.eg',
      name: 'Merchant',
      role: 'merchant',
      merchantId: f.merchant.id,
      password,
      actorUserId: owner,
    });
    expect(await prisma.employee.findUnique({ where: { userId: merchantUser.id } })).toBeNull();
    // Moving the rider to another store moves the file's store too.
    await updateUser(prisma, { userId: user.id, darkStoreId: f.other.id, actorUserId: owner });
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: file.id } })).homeStoreId).toBe(
      f.other.id,
    );
    // The owner made straight in the database has none until the backfill runs.
    expect(await ensureEmployees(prisma)).toBe(1);
    expect(await ensureEmployees(prisma)).toBe(0);
  });

  it('updates a file with before and after, and keeps bank details behind salaries', async () => {
    const { file } = await rider();
    await expect(
      updateEmployee(prisma, {
        employeeId: file.id,
        body: { iban: 'EG380019000500000000263180002' },
        actorUserId: owner,
        bank: false,
        scope: null,
      }),
    ).rejects.toThrow('salaries_required');
    await expect(
      updateEmployee(prisma, {
        employeeId: file.id,
        body: { homeStoreId: f.other.id },
        actorUserId: owner,
        bank: true,
        scope: null,
      }),
    ).rejects.toThrow('store_set_on_account');
    await expect(
      updateEmployee(prisma, {
        employeeId: file.id,
        body: { contractType: 'fixed_term' },
        actorUserId: owner,
        bank: false,
        scope: null,
      }),
    ).rejects.toThrow('contract_end_required');
    const updated = await updateEmployee(prisma, {
      employeeId: file.id,
      body: {
        nameAr: 'راكب',
        nationalId: '29001011234567',
        jobTitle: 'Rider',
        department: 'delivery',
        mobile: '+201112345678',
        iban: 'EG380019000500000000263180002',
      },
      actorUserId: owner,
      bank: true,
      scope: null,
    });
    expect(updated).toMatchObject({
      nameAr: 'راكب',
      mobile: '+201112345678',
      bank: { iban: 'EG380019000500000000263180002' },
    });
    // People limited to other stores cannot open it.
    await expect(
      getEmployee(prisma, file.id, { scope: [f.other.id], bank: false }),
    ).rejects.toThrow('store_not_allowed');
    expect((await getEmployee(prisma, file.id, { scope: [f.store.id], bank: false })).bank).toBe(
      null,
    );
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'employee.update', entityId: file.id },
    });
    expect(audit.before).toMatchObject({ nationalId: null, mobile: '+201012345678' });
    expect(audit.after).toMatchObject({ nationalId: '29001011234567', mobile: '+201112345678' });
    const list = await listEmployees(prisma, { scope: null, department: 'delivery' });
    expect(list.map((e) => e.id)).toEqual([file.id]);
    expect(await listEmployees(prisma, { scope: [f.other.id] })).toEqual([]);
  });

  it('marks a person as left: the account is disabled and signed out', async () => {
    const { user, file } = await rider();
    await prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: 'h', expiresAt: new Date(Date.now() + 86_400_000) },
    });
    const left = await setEmployeeStatus(prisma, {
      employeeId: file.id,
      body: { status: 'left', leftOn: today, reason: 'Resigned' },
      actorUserId: owner,
      scope: null,
    });
    expect(left).toMatchObject({ status: 'left', leftOn: today, leftReason: 'Resigned' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).isActive).toBe(false);
    expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(
      0,
    );
    // The database refuses a left status without its date and reason.
    await expect(
      prisma.employee.update({ where: { id: file.id }, data: { leftReason: null } }),
    ).rejects.toThrow();
  });

  it('keeps the national ID and insurance number set from payroll on the file', async () => {
    const { user, file } = await rider();
    await setSalary(prisma, {
      userId: user.id,
      monthlyPiastres: 600_000,
      nationalId: '29001011234567',
      insuranceNumber: 'SI-1',
      actorUserId: owner,
    });
    expect(await prisma.employee.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({
      nationalId: '29001011234567',
      socialInsuranceNumber: 'SI-1',
    });
    const pay = await listStaffPay(prisma);
    expect(pay.find((p) => p.userId === user.id)).toMatchObject({
      nationalId: '29001011234567',
      insuranceNumber: 'SI-1',
    });
  });
});

describe('documents', () => {
  it('stores photos and PDFs, refuses other files, and deletes with an audit row', async () => {
    const { file } = await rider();
    const base = { employeeId: file.id, actorUserId: owner, scope: null };
    await expect(
      addEmployeeDocument(prisma, {
        ...base,
        kind: 'contract',
        contentType: 'text/plain',
        data: Buffer.from('hi'),
      }),
    ).rejects.toThrow('document_type_not_allowed');
    await expect(
      addEmployeeDocument(prisma, {
        ...base,
        kind: 'contract',
        contentType: 'application/pdf',
        data: JPEG,
      }),
    ).rejects.toThrow('document_not_readable');
    await expect(
      addEmployeeDocument(prisma, {
        ...base,
        kind: 'contract',
        contentType: 'application/pdf',
        data: Buffer.concat([PDF, Buffer.alloc(3_000_001)]),
      }),
    ).rejects.toThrow('document_too_large');
    const doc = await addEmployeeDocument(prisma, {
      ...base,
      kind: 'contract',
      contentType: 'application/pdf',
      data: PDF,
      issuedOn: '2026-01-01',
      expiresOn: '2027-01-01',
    });
    expect(doc).toMatchObject({ kind: 'contract', expiresOn: '2027-01-01' });
    expect(await listEmployeeDocuments(prisma, file.id, null)).toHaveLength(1);
    await deleteEmployeeDocument(prisma, { ...base, documentId: doc.id });
    expect(await listEmployeeDocuments(prisma, file.id, null)).toHaveLength(0);
    const history = await employeeHistory(prisma, { employeeId: file.id, scope: null, pay: false });
    expect(history.map((h) => h.action)).toEqual([
      'employee.document_delete',
      'employee.document_add',
      'user.create',
    ]);
  });

  it('raises one expiring and one expired alert per document, however often it runs', async () => {
    const { file } = await rider();
    const now = new Date('2026-11-06T10:00:00Z');
    const add = (expiresOn: string, kind: 'medical' | 'criminal_record') =>
      addEmployeeDocument(prisma, {
        employeeId: file.id,
        kind,
        contentType: 'image/jpeg',
        data: JPEG,
        expiresOn,
        actorUserId: owner,
        scope: null,
      });
    const soon = await add('2026-11-20', 'medical');
    await add('2027-06-01', 'criminal_record');
    await prisma.employee.update({
      where: { id: file.id },
      data: { nationalIdExpiresOn: new Date('2026-11-06T00:00:00Z') },
    });
    expect(await checkDocumentExpiry(prisma, now)).toEqual({ raised: 2 });
    expect(await checkDocumentExpiry(prisma, now)).toEqual({ raised: 0 });
    const alerts = await prisma.alert.findMany({ orderBy: { type: 'asc' } });
    expect(alerts.map((a) => [a.type, a.darkStoreId])).toEqual([
      ['document_expired', f.store.id],
      ['document_expiring', f.store.id],
    ]);
    expect(alerts[1]!.data).toMatchObject({ documentId: soon.id, expiresOn: '2026-11-20' });
    // On the day it runs out, the expired alert follows once.
    const day = new Date('2026-11-20T08:00:00Z');
    expect(await checkDocumentExpiry(prisma, day)).toEqual({ raised: 1 });
    expect(await checkDocumentExpiry(prisma, day)).toEqual({ raised: 0 });
    // The alert window is a setting.
    await prisma.setting.create({
      data: { key: 'hr.document_alert_days', scope: 'global', value: 365 },
    });
    expect(await checkDocumentExpiry(prisma, day)).toEqual({ raised: 1 });
  });
});

describe('history', () => {
  it('joins the file, the account, access and pay (pay only with salaries)', async () => {
    const { user, file } = await rider();
    await setSalary(prisma, { userId: user.id, monthlyPiastres: 500_000, actorUserId: owner });
    await updateEmployee(prisma, {
      employeeId: file.id,
      body: { bankName: 'CIB', jobTitle: 'Senior rider' },
      actorUserId: owner,
      bank: true,
      scope: null,
    });
    const withPay = await employeeHistory(prisma, { employeeId: file.id, scope: null, pay: true });
    expect(withPay.map((h) => h.action)).toEqual([
      'employee.update',
      'finance.salary_set',
      'user.create',
    ]);
    expect(withPay[0]!.after).toMatchObject({ bankName: 'CIB' });
    const without = await employeeHistory(prisma, {
      employeeId: file.id,
      scope: null,
      pay: false,
    });
    expect(without.map((h) => h.action)).toEqual(['employee.update', 'user.create']);
    expect(without[0]!.after).not.toHaveProperty('bankName');
    expect(without[0]!.after).toMatchObject({ jobTitle: 'Senior rider' });
  });
});

describe('account managers', () => {
  it('limits an account manager to the merchants they look after', async () => {
    const am = await createUser(prisma, {
      email: 'am@t.eg',
      name: 'Account Manager',
      role: 'admin',
      password,
      jobRole: 'account_manager',
      actorUserId: owner,
    });
    expect(await getAccessProfile(prisma, am.id)).toMatchObject({
      jobRole: 'account_manager',
      ownMerchantsOnly: true,
      merchants: 'use',
      merchantIds: [],
    });
    await setAccountManager(prisma, {
      merchantId: f.merchant.id,
      userId: am.id,
      actorUserId: owner,
    });
    expect((await getAccessProfile(prisma, am.id))?.merchantIds).toEqual([f.merchant.id]);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'merchant.account_manager' },
    });
    expect(audit.after).toEqual({ accountManagerId: am.id });
    // The HR officer job role reaches HR only.
    await setUserAccess(prisma, {
      userId: am.id,
      body: { jobRole: 'hr_officer' },
      actorUserId: owner,
    });
    expect(await getAccessProfile(prisma, am.id)).toMatchObject({
      hr: 'manage',
      merchants: 'none',
      ownMerchantsOnly: false,
      merchantIds: [],
    });
    await expect(
      setAccountManager(prisma, {
        merchantId: f.merchant.id,
        userId: 'nobody',
        actorUserId: owner,
      }),
    ).rejects.toThrow('user_not_found');
  });
});
