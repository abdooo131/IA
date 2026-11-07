import { cairoDay, JOB_ROLE_TEMPLATES } from '@shiplynow/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getAccessProfile, setUserAccess, writeAccess } from '../src/access';
import { createUser, updateUser } from '../src/admin-ops';
import { listStaffPay, previewPayroll } from '../src/finance/payroll';
import {
  employeeHistory,
  ensureEmployees,
  getEmployee,
  listEmployees,
  setAccountManager,
  setEmployeeStatus,
  updateEmployee,
} from '../src/hr';
import { employeeChecklists, setChecklistTask, startChecklistFor } from '../src/hr-checklists';
import { ensureHrDefaults, placeSeedPeople } from '../src/hr-defaults';
import {
  addEmployeeDocument,
  checkDocumentExpiry,
  completenessFor,
  deleteEmployeeDocument,
  documentChecklist,
  listEmployeeDocuments,
  missingDocuments,
  reviewEmployeeDocument,
  setEmployeePhoto,
} from '../src/hr-documents';
import {
  createDepartment,
  findManagerLoop,
  managerLinks,
  managerOf,
  orgChart,
  teamOf,
  updateDepartment,
  updatePosition,
} from '../src/hr-org';
import { listSalaryPackages, setEmployment, setSalary, setSalaryPackage } from '../src/hr-pay';
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
  await ensureHrDefaults(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function rider(n = 1) {
  const user = await createUser(prisma, {
    email: `rider${n}@t.eg`,
    name: `Rider ${n === 1 ? 'One' : n}`,
    role: 'rider',
    password,
    darkStoreId: f.store.id,
    badgeCode: `R-${n}`,
    phone: `+20101234567${n}`,
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
        departmentId: 'dept_ops_rid',
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
    expect(audit.before).toMatchObject({ nationalId: null, mobile: '+201012345671' });
    expect(audit.after).toMatchObject({ nationalId: '29001011234567', mobile: '+201112345678' });
    const list = await listEmployees(prisma, { scope: null, departmentId: 'dept_ops_rid' });
    expect(list.map((e) => e.id)).toEqual([file.id]);
    // A department covers the departments below it, and search finds the mobile as typed.
    expect(
      (await listEmployees(prisma, { scope: null, departmentId: 'dept_ops' })).map((e) => e.id),
    ).toEqual([file.id]);
    expect(
      (await listEmployees(prisma, { scope: null, q: '01112345678' })).map((e) => e.id),
    ).toEqual([file.id]);
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

/** A team member with an employee file (admin account, no store). */
async function office(email: string, name: string) {
  const user = await createUser(prisma, {
    email,
    name,
    role: 'admin',
    password,
    jobRole: 'operations_manager',
    actorUserId: owner,
  });
  return prisma.employee.findUniqueOrThrow({ where: { userId: user.id } });
}

const noBank = { actorUserId: '', bank: false, scope: null } as const;
const edit = (employeeId: string, body: Parameters<typeof updateEmployee>[1]['body']) =>
  updateEmployee(prisma, { ...noBank, actorUserId: owner, employeeId, body });

describe('organisation', () => {
  it('builds the department tree and refuses a department under itself', async () => {
    const qc = await prisma.department.findUniqueOrThrow({ where: { code: 'OPS-QC' } });
    expect(qc.parentId).toBe('dept_ops');
    const lab = await createDepartment(prisma, {
      body: { code: 'QC-LAB', nameEn: 'QC lab', nameAr: 'معمل الجودة', parentId: qc.id },
      actorUserId: owner,
    });
    await expect(
      updateDepartment(prisma, { id: 'dept_ops', body: { parentId: lab.id }, actorUserId: owner }),
    ).rejects.toThrow('department_loop');
    await expect(
      updateDepartment(prisma, { id: lab.id, body: { parentId: lab.id }, actorUserId: owner }),
    ).rejects.toThrow('department_loop');
    // A department with people in it cannot be closed.
    const { file } = await rider();
    expect(file.departmentId).toBe('dept_ops_rid');
    await expect(
      updateDepartment(prisma, {
        id: 'dept_ops_rid',
        body: { isActive: false },
        actorUserId: owner,
      }),
    ).rejects.toThrow('department_in_use');
  });

  it('takes the manager from the department head chain unless one is set', async () => {
    const ceo = await office('ceo@t.eg', 'Chief');
    const head = await office('ops@t.eg', 'Ops Head');
    const { file: r } = await rider();
    await updateDepartment(prisma, {
      id: 'dept_mgt',
      body: { headEmployeeId: ceo.id },
      actorUserId: owner,
    });
    // Nobody heads Riders or Operations yet: the chain reaches Management's head.
    expect(await managerOf(prisma, r.id)).toEqual({ managerId: ceo.id, source: 'department' });
    await updateDepartment(prisma, {
      id: 'dept_ops',
      body: { headEmployeeId: head.id },
      actorUserId: owner,
    });
    expect(await managerOf(prisma, r.id)).toEqual({ managerId: head.id, source: 'department' });
    // The directory shows the manager in force too.
    const listed = await listEmployees(prisma, { scope: null });
    expect(listed.find((e) => e.id === r.id)?.manager?.id).toBe(head.id);
    // The head of a department reports to the head above, not to themself.
    await edit(head.id, { departmentId: 'dept_ops' });
    expect((await managerOf(prisma, head.id)).managerId).toBe(ceo.id);
    // A manager set on the file wins.
    await edit(r.id, { managerId: ceo.id });
    expect(await managerOf(prisma, r.id)).toEqual({ managerId: ceo.id, source: 'set' });
    const file = await getEmployee(prisma, r.id, { scope: null, bank: false });
    expect(file).toMatchObject({ managerSource: 'set', effectiveManager: { id: ceo.id } });
    // Team views reach direct and indirect reports.
    expect(await teamOf(prisma, ceo.id)).toMatchObject({ total: 2, direct: 2 });
    const chart = await orgChart(prisma);
    expect(chart.people.find((p) => p.id === head.id)?.managerId).toBe(ceo.id);
    expect(chart.vacancies.find((v) => v.code === 'RIDER')?.open).toBe(12);
  });

  it('refuses a manager chain that loops, set or through department heads', async () => {
    const a = await office('a@t.eg', 'Alpha');
    const b = await office('b@t.eg', 'Beta');
    await edit(b.id, { managerId: a.id });
    await expect(edit(a.id, { managerId: b.id })).rejects.toThrow('manager_loop');
    await expect(edit(a.id, { managerId: a.id })).rejects.toThrow('manager_is_self');
    // Alpha in Finance, headed by Beta, while Beta reports to Alpha: a loop through the head.
    await edit(a.id, { departmentId: 'dept_fin' });
    await expect(
      updateDepartment(prisma, {
        id: 'dept_fin',
        body: { headEmployeeId: b.id },
        actorUserId: owner,
      }),
    ).rejects.toThrow('manager_loop');
    const fin = await prisma.department.findUniqueOrThrow({ where: { id: 'dept_fin' } });
    expect(fin.headEmployeeId).toBeNull();
    // The pure functions agree.
    const links = managerLinks(
      [
        { id: 'x', managerId: 'y', departmentId: null },
        { id: 'y', managerId: null, departmentId: 'd' },
      ],
      [{ id: 'd', parentId: null, headEmployeeId: 'x' }],
    );
    expect(findManagerLoop(links)).not.toBeNull();
  });

  it('keeps a grade inside the position range and fills the department from it', async () => {
    const { file } = await rider();
    await expect(
      edit(file.id, { positionId: 'pos_rider', gradeId: 'grade_director' }),
    ).rejects.toThrow('grade_outside_position');
    const e = await office('am@t.eg', 'Accounts');
    expect(await edit(e.id, { positionId: 'pos_am', gradeId: 'grade_mid' })).toMatchObject({
      department: { code: 'COM-AM' },
      position: { titleEn: 'Account manager' },
      grade: { code: 'MID' },
    });
    await expect(
      updatePosition(prisma, {
        id: 'pos_am',
        body: { minGradeId: 'grade_head', maxGradeId: 'grade_junior' },
        actorUserId: owner,
      }),
    ).rejects.toThrow('grade_range_reversed');
  });

  it('places seeded people so the chart has a top and teams', async () => {
    await office('ceo@t.eg', 'Chief');
    const staff = await createUser(prisma, {
      email: 'st@t.eg',
      name: 'Store Lead',
      role: 'store_staff',
      password,
      darkStoreId: f.store.id,
      actorUserId: owner,
    });
    await rider();
    // The owner (no file yet), the chief, the store lead and the rider.
    await ensureEmployees(prisma);
    expect(await placeSeedPeople(prisma)).toBe(4);
    expect(await placeSeedPeople(prisma)).toBe(0);
    const lead = await prisma.employee.findUniqueOrThrow({ where: { userId: staff.id } });
    expect(lead.positionId).toBe('pos_store_mgr');
    const team = await teamOf(prisma, lead.id);
    expect(team.people.map((p) => p.nameEn)).toEqual(['Rider One']);
    const top = await prisma.department.findUniqueOrThrow({ where: { id: 'dept_mgt' } });
    expect(top.headEmployeeId).not.toBeNull();
  });
});

describe('employment and salary package (HR owns, payroll reads)', () => {
  it('keeps package history and the payroll run reads the one in force', async () => {
    const { user, file } = await rider();
    await prisma.employee.update({
      where: { id: file.id },
      data: { hireDate: new Date('2026-01-01T00:00:00Z'), gradeId: 'grade_junior' },
    });
    await prisma.grade.update({
      where: { id: 'grade_junior' },
      data: { bandMinPiastres: 500_000, bandMaxPiastres: 900_000 },
    });
    const first = await setSalaryPackage(prisma, {
      employeeId: file.id,
      body: {
        basicPiastres: 600_000,
        allowances: [
          { kind: 'transport', amountPiastres: 100_000 },
          { kind: 'phone', amountPiastres: 25_000 },
        ],
      },
      actorUserId: owner,
    });
    // The first package starts on the hire date.
    expect(first).toMatchObject({
      effectiveFrom: '2026-01-01',
      grossPiastres: 725_000,
      outsideBand: false,
    });
    const raise = await setSalaryPackage(prisma, {
      employeeId: file.id,
      body: {
        effectiveFrom: '2026-07-01',
        basicPiastres: 900_000,
        allowances: [{ kind: 'housing', amountPiastres: 200_000 }],
        note: 'Promotion',
      },
      actorUserId: owner,
    });
    expect(raise).toMatchObject({ grossPiastres: 1_100_000, outsideBand: true });
    const history = await listSalaryPackages(prisma, file.id);
    expect(history.map((h) => [h.effectiveFrom, h.grossPiastres, h.current])).toEqual([
      ['2026-07-01', 1_100_000, true],
      ['2026-01-01', 725_000, false],
    ]);
    // Payroll pays the package in force on the month's last day: basic plus allowances.
    const run = (month: string) =>
      previewPayroll(prisma, { month, moneyAccountId: 'x', lines: [{ userId: user.id }] });
    expect((await run('2026-03')).rows[0]).toMatchObject({ base: 725_000 });
    expect((await run('2026-08')).rows[0]).toMatchObject({ base: 1_100_000 });
    expect((await listStaffPay(prisma)).find((p) => p.userId === user.id)).toMatchObject({
      monthlyPiastres: 1_100_000,
      basicPiastres: 900_000,
      allowancesPiastres: 200_000,
      packageFrom: '2026-07-01',
    });
    // Pay changes are in the history only with the salaries switch.
    const withPay = await employeeHistory(prisma, { employeeId: file.id, scope: null, pay: true });
    expect(withPay.filter((h) => h.action === 'employee.package')).toHaveLength(2);
    const without = await employeeHistory(prisma, {
      employeeId: file.id,
      scope: null,
      pay: false,
    });
    expect(without.some((h) => h.action === 'employee.package')).toBe(false);
  });

  it('moves a person to an outsourcing company: no package, the contract follows', async () => {
    const { user, file } = await rider();
    const agency = await prisma.supplier.create({
      data: { name: 'Delta Staffing', createdById: owner },
    });
    await expect(
      setEmployment(prisma, { userId: user.id, employment: 'outsourced', actorUserId: owner }),
    ).rejects.toThrow('staffing_company_required');
    await setEmployment(prisma, {
      userId: user.id,
      employment: 'outsourced',
      staffingSupplierId: agency.id,
      actorUserId: owner,
    });
    expect(await prisma.employee.findUniqueOrThrow({ where: { id: file.id } })).toMatchObject({
      employment: 'outsourced',
      contractType: 'outsourced',
      staffingSupplierId: agency.id,
    });
    await expect(
      setSalary(prisma, { userId: user.id, monthlyPiastres: 1, actorUserId: owner }),
    ).rejects.toThrow('outsourced_not_on_payroll');
    await expect(edit(file.id, { contractType: 'permanent' })).rejects.toThrow(
      'contract_follows_employment',
    );
    // The database keeps an outsourced person tied to their company.
    await expect(
      prisma.employee.update({ where: { id: file.id }, data: { staffingSupplierId: null } }),
    ).rejects.toThrow();
  });
});

describe('documents', () => {
  const base = () => ({ actorUserId: owner, scope: null });

  it('checks the type rules, keeps versions and deletes back to the version before', async () => {
    const { file } = await rider();
    const add = (extra: Partial<Parameters<typeof addEmployeeDocument>[1]>) =>
      addEmployeeDocument(prisma, {
        ...base(),
        employeeId: file.id,
        typeId: 'doctype_contract',
        contentType: 'application/pdf',
        data: PDF,
        ...extra,
      });
    await expect(add({ contentType: 'text/plain', data: Buffer.from('hi') })).rejects.toThrow(
      'document_type_not_allowed',
    );
    await expect(add({ data: JPEG })).rejects.toThrow('document_not_readable');
    await prisma.employeeDocumentType.update({
      where: { id: 'doctype_contract' },
      data: { maxBytes: 20, allowedTypes: ['application/pdf'] },
    });
    await expect(add({ data: Buffer.concat([PDF, Buffer.alloc(30)]) })).rejects.toThrow(
      'document_too_large',
    );
    await expect(add({ contentType: 'image/jpeg', data: JPEG })).rejects.toThrow(
      'document_type_not_allowed',
    );
    // A type with an expiry needs the date.
    await expect(
      add({ typeId: 'doctype_national_id', contentType: 'image/jpeg', data: JPEG }),
    ).rejects.toThrow('expiry_required');
    const v1 = await add({ title: 'First' });
    const v2 = await add({ title: 'Signed again' });
    expect(v1).toMatchObject({ version: 1, status: 'verified' });
    expect(v2).toMatchObject({ version: 2, previousId: v1.id, isCurrent: true });
    const all = await listEmployeeDocuments(prisma, file.id, { scope: null, confidential: true });
    expect(all.map((d) => [d.version, d.isCurrent])).toEqual([
      [2, true],
      [1, false],
    ]);
    // HR view does not see confidential types (the contract is one).
    expect(
      await listEmployeeDocuments(prisma, file.id, { scope: null, confidential: false }),
    ).toEqual([]);
    // Several qualifications live side by side.
    const q1 = await add({ typeId: 'doctype_qualification', title: 'BSc' });
    const q2 = await add({ typeId: 'doctype_qualification', title: 'Course' });
    expect([q1.isCurrent, q2.isCurrent, q2.version]).toEqual([true, true, 1]);
    // Deleting the current version brings back the one before.
    await deleteEmployeeDocument(prisma, { ...base(), employeeId: file.id, documentId: v2.id });
    const after = await listEmployeeDocuments(prisma, file.id, { scope: null, confidential: true });
    expect(after.find((d) => d.id === v1.id)?.isCurrent).toBe(true);
    const history = await employeeHistory(prisma, { employeeId: file.id, scope: null, pay: false });
    expect(history.map((h) => h.action)).toEqual(
      expect.arrayContaining(['employee.document_delete', 'employee.document_add', 'user.create']),
    );
  });

  it('shows a checklist with completeness, verification and self service uploads', async () => {
    const { user, file } = await rider();
    const self = (typeId: string, contentType = 'image/jpeg', data = JPEG) =>
      addEmployeeDocument(prisma, {
        employeeId: file.id,
        typeId,
        contentType,
        data,
        expiresOn: '2030-01-01',
        actorUserId: user.id,
        scope: null,
        self: true,
      });
    // A rider must have the ID, the contract, the criminal record and a driving licence.
    let list = await documentChecklist(prisma, file.id, { confidential: true });
    expect(list.items.filter((i) => i.required).map((i) => [i.type.code, i.state])).toEqual([
      ['national_id', 'missing'],
      ['contract', 'missing'],
      ['criminal_record', 'missing'],
      ['driving_license', 'missing'],
    ]);
    expect(list.percent).toBe(0);
    // HR uploads the contract: verified at once.
    await addEmployeeDocument(prisma, {
      ...base(),
      employeeId: file.id,
      typeId: 'doctype_contract',
      contentType: 'application/pdf',
      data: PDF,
    });
    // The rider uploads their ID from My HR: it waits for HR.
    const mine = await self('doctype_national_id');
    expect(mine).toMatchObject({ status: 'pending', selfUploaded: true });
    // Not twice while it waits, and never a confidential type.
    await expect(self('doctype_national_id')).rejects.toThrow('document_already_on_file');
    await expect(self('doctype_contract', 'application/pdf', PDF)).rejects.toThrow(
      'self_upload_not_allowed',
    );
    list = await documentChecklist(prisma, file.id, { confidential: true });
    expect(list.items.find((i) => i.type.code === 'national_id')?.state).toBe('pending');
    expect(list.percent).toBe(25);
    // HR refuses it with a note; the rider may upload again.
    expect(
      await reviewEmployeeDocument(prisma, {
        ...base(),
        employeeId: file.id,
        documentId: mine.id,
        body: { status: 'rejected', note: 'Blurry, take it again' },
      }),
    ).toMatchObject({ status: 'rejected', reviewNote: 'Blurry, take it again' });
    const again = await self('doctype_national_id');
    expect(again).toMatchObject({ version: 2, status: 'pending' });
    await reviewEmployeeDocument(prisma, {
      ...base(),
      employeeId: file.id,
      documentId: again.id,
      body: { status: 'verified' },
    });
    list = await documentChecklist(prisma, file.id, { confidential: true });
    expect(list.percent).toBe(50);
    expect((await completenessFor(prisma, [file.id])).get(file.id)).toEqual({
      percent: 50,
      missing: 2,
    });
    // The company view lists what is still missing, per person and type.
    const missing = await missingDocuments(prisma, { scope: null });
    expect(
      missing.filter((m) => m.employee.id === file.id).map((m) => [m.type.code, m.state]),
    ).toEqual([
      ['criminal_record', 'missing'],
      ['driving_license', 'missing'],
    ]);
    expect(await missingDocuments(prisma, { scope: [f.other.id] })).toEqual([]);
  });

  it('raises one expiring and one expired alert per document, with its type alert days', async () => {
    const { file } = await rider();
    const now = new Date('2026-11-06T10:00:00Z');
    const add = (expiresOn: string, typeId: string) =>
      addEmployeeDocument(prisma, {
        employeeId: file.id,
        typeId,
        contentType: 'image/jpeg',
        data: JPEG,
        expiresOn,
        actorUserId: owner,
        scope: null,
      });
    const soon = await add('2026-11-20', 'doctype_medical');
    await add('2027-06-01', 'doctype_criminal_record');
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
    expect(alerts[1]!.data).toMatchObject({
      documentId: soon.id,
      kind: 'medical',
      typeNameEn: 'Medical certificate',
      expiresOn: '2026-11-20',
    });
    const day = new Date('2026-11-20T08:00:00Z');
    expect(await checkDocumentExpiry(prisma, day)).toEqual({ raised: 1 });
    expect(await checkDocumentExpiry(prisma, day)).toEqual({ raised: 0 });
    // A type may warn earlier than the general setting.
    await prisma.employeeDocumentType.update({
      where: { id: 'doctype_criminal_record' },
      data: { alertDays: 365 },
    });
    expect(await checkDocumentExpiry(prisma, day)).toEqual({ raised: 1 });
  });

  it('keeps a square photo of the person', async () => {
    const { file } = await rider();
    await expect(
      setEmployeePhoto(prisma, {
        ...base(),
        employeeId: file.id,
        contentType: 'application/pdf',
        data: PDF,
      }),
    ).rejects.toThrow('photo_type_not_allowed');
    const set = await setEmployeePhoto(prisma, {
      ...base(),
      employeeId: file.id,
      contentType: 'image/jpeg',
      data: JPEG,
    });
    expect(set.photoVersion).toBeGreaterThan(0);
    const listed = await listEmployees(prisma, { scope: null });
    expect(listed.find((e) => e.id === file.id)?.photoVersion).toBe(set.photoVersion);
  });
});

describe('onboarding and offboarding', () => {
  it('starts on hire, ticks document tasks by itself and offboards on leaving', async () => {
    const { file } = await rider();
    // The account was made before the rider had a position: the default onboarding started.
    let lists = await employeeChecklists(prisma, file.id);
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ kind: 'onboarding', nameEn: 'Onboarding', status: 'open' });
    await expect(
      startChecklistFor(prisma, {
        employeeId: file.id,
        body: { kind: 'onboarding' },
        actorUserId: owner,
      }),
    ).rejects.toThrow('checklist_open');
    // A verified ID ticks its task by itself.
    await addEmployeeDocument(prisma, {
      employeeId: file.id,
      typeId: 'doctype_national_id',
      contentType: 'image/jpeg',
      data: JPEG,
      expiresOn: '2030-01-01',
      actorUserId: owner,
      scope: null,
    });
    lists = await employeeChecklists(prisma, file.id);
    const idTask = lists[0]!.tasks.find((t) => t.documentTypeId === 'doctype_national_id')!;
    expect(idTask.doneAt).not.toBeNull();
    // HR ticks the rest; the checklist closes with the last one.
    for (const t of lists[0]!.tasks.filter((x) => !x.doneAt))
      await setChecklistTask(prisma, {
        employeeId: file.id,
        taskId: t.id,
        body: { done: true },
        actorUserId: owner,
      });
    lists = await employeeChecklists(prisma, file.id);
    expect(lists[0]).toMatchObject({ status: 'done' });
    expect(lists[0]!.done).toBe(lists[0]!.total);
    // A person in the Rider position gets the rider onboarding.
    const second = await rider(2);
    await prisma.employeeChecklist.updateMany({
      where: { employeeId: second.file.id },
      data: { status: 'cancelled' },
    });
    await prisma.employee.update({
      where: { id: second.file.id },
      data: { positionId: 'pos_rider' },
    });
    const started = await startChecklistFor(prisma, {
      employeeId: second.file.id,
      body: { kind: 'onboarding', startsOn: '2026-11-01' },
      actorUserId: owner,
    });
    expect(started.nameEn).toBe('Rider onboarding');
    // Leaving starts the offboarding checklist from the last day.
    await setEmployeeStatus(prisma, {
      employeeId: file.id,
      body: { status: 'left', leftOn: today, reason: 'Moved city' },
      actorUserId: owner,
      scope: null,
    });
    lists = await employeeChecklists(prisma, file.id);
    expect(lists.find((c) => c.kind === 'offboarding')).toMatchObject({
      status: 'open',
      startsOn: today,
    });
  });
});
