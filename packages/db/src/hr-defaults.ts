import type { Db } from './client';

// HR v2 defaults (docs/HR.md): the departments, grades and document types the migration also
// adds (same fixed ids), the job positions and the onboarding and offboarding checklists.
// Only missing rows are created (by code), so HR's own edits are never overwritten.

type Dept = [id: string, code: string, en: string, ar: string, parent: string | null, sort: number];
export const DEFAULT_DEPARTMENTS: Dept[] = [
  ['dept_mgt', 'MGT', 'Management', 'الإدارة العليا', null, 0],
  ['dept_ops', 'OPS', 'Operations', 'العمليات', 'dept_mgt', 1],
  ['dept_ops_ds', 'OPS-DS', 'Dark stores', 'المخازن المظلمة', 'dept_ops', 1],
  ['dept_ops_hub', 'OPS-HUB', 'Hub', 'مركز الفرز', 'dept_ops', 2],
  ['dept_ops_rid', 'OPS-RID', 'Riders', 'المناديب', 'dept_ops', 3],
  ['dept_ops_qc', 'OPS-QC', 'Quality control', 'مراقبة الجودة', 'dept_ops', 4],
  ['dept_com', 'COM', 'Commercial', 'التجاري', 'dept_mgt', 2],
  ['dept_com_am', 'COM-AM', 'Account management', 'إدارة حسابات التجار', 'dept_com', 1],
  ['dept_com_sal', 'COM-SAL', 'Sales', 'المبيعات', 'dept_com', 2],
  ['dept_fin', 'FIN', 'Finance', 'المالية', 'dept_mgt', 3],
  ['dept_hr', 'HR', 'Human resources', 'الموارد البشرية', 'dept_mgt', 4],
  ['dept_tech', 'TECH', 'Technology', 'التكنولوجيا', 'dept_mgt', 5],
  ['dept_cs', 'CS', 'Customer service', 'خدمة العملاء', 'dept_mgt', 6],
];

type GradeRow = [id: string, code: string, en: string, ar: string, rank: number];
export const DEFAULT_GRADES: GradeRow[] = [
  ['grade_intern', 'INTERN', 'Intern', 'متدرب', 1],
  ['grade_junior', 'JUNIOR', 'Junior', 'مبتدئ', 2],
  ['grade_mid', 'MID', 'Mid level', 'متوسط الخبرة', 3],
  ['grade_senior', 'SENIOR', 'Senior', 'خبير', 4],
  ['grade_lead', 'LEAD', 'Lead', 'قائد فريق', 5],
  ['grade_supervisor', 'SUPERVISOR', 'Supervisor', 'مشرف', 6],
  ['grade_manager', 'MANAGER', 'Manager', 'مدير', 7],
  ['grade_head', 'HEAD', 'Head', 'رئيس قسم', 8],
  ['grade_director', 'DIRECTOR', 'Director', 'مدير إدارة', 9],
  ['grade_chief', 'CHIEF', 'Chief (C level)', 'رئيس تنفيذي', 10],
];

interface DocTypeRow {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  hasExpiry: boolean;
  required: boolean;
  requiredEmployment?: string[];
  requiredDepartmentIds?: string[];
  confidential?: boolean;
  selfUpload?: boolean;
  multiple?: boolean;
  sort: number;
}
export const DEFAULT_DOCUMENT_TYPES: DocTypeRow[] = [
  {
    id: 'doctype_national_id',
    code: 'national_id',
    nameEn: 'National ID copy',
    nameAr: 'صورة البطاقة',
    hasExpiry: true,
    required: true,
    sort: 1,
  },
  {
    id: 'doctype_contract',
    code: 'contract',
    nameEn: 'Signed contract',
    nameAr: 'العقد الموقع',
    hasExpiry: false,
    required: true,
    requiredEmployment: ['employee'],
    confidential: true,
    selfUpload: false,
    sort: 2,
  },
  {
    id: 'doctype_criminal_record',
    code: 'criminal_record',
    nameEn: 'Criminal record certificate',
    nameAr: 'فيش وتشبيه',
    hasExpiry: true,
    required: true,
    sort: 3,
  },
  {
    id: 'doctype_military_status',
    code: 'military_status',
    nameEn: 'Military status',
    nameAr: 'الموقف من التجنيد',
    hasExpiry: false,
    required: false,
    sort: 4,
  },
  {
    id: 'doctype_qualification',
    code: 'qualification',
    nameEn: 'Qualification',
    nameAr: 'المؤهل الدراسي',
    hasExpiry: false,
    required: false,
    multiple: true,
    sort: 5,
  },
  {
    id: 'doctype_medical',
    code: 'medical',
    nameEn: 'Medical certificate',
    nameAr: 'شهادة طبية',
    hasExpiry: true,
    required: false,
    confidential: true,
    sort: 6,
  },
  {
    id: 'doctype_driving_license',
    code: 'driving_license',
    nameEn: 'Driving licence',
    nameAr: 'رخصة القيادة',
    hasExpiry: true,
    required: true,
    requiredDepartmentIds: ['dept_ops_rid'],
    sort: 7,
  },
  {
    id: 'doctype_other',
    code: 'other',
    nameEn: 'Other',
    nameAr: 'أخرى',
    hasExpiry: false,
    required: false,
    multiple: true,
    sort: 99,
  },
];

type PositionRow = [
  id: string,
  code: string,
  en: string,
  ar: string,
  department: string,
  min: string,
  max: string,
  planned: number,
];
export const DEFAULT_POSITIONS: PositionRow[] = [
  [
    'pos_ceo',
    'CEO',
    'Chief executive officer',
    'الرئيس التنفيذي',
    'dept_mgt',
    'grade_chief',
    'grade_chief',
    1,
  ],
  [
    'pos_coo',
    'COO',
    'Head of operations',
    'رئيس العمليات',
    'dept_ops',
    'grade_head',
    'grade_chief',
    1,
  ],
  [
    'pos_store_mgr',
    'STORE-MGR',
    'Store manager',
    'مدير مخزن',
    'dept_ops_ds',
    'grade_supervisor',
    'grade_manager',
    3,
  ],
  [
    'pos_picker',
    'PICKER',
    'Picker and packer',
    'مجهز طلبات',
    'dept_ops_ds',
    'grade_intern',
    'grade_senior',
    9,
  ],
  [
    'pos_hub_lead',
    'HUB-LEAD',
    'Hub supervisor',
    'مشرف مركز الفرز',
    'dept_ops_hub',
    'grade_supervisor',
    'grade_manager',
    1,
  ],
  [
    'pos_hub_staff',
    'HUB-STAFF',
    'Hub associate',
    'موظف مركز الفرز',
    'dept_ops_hub',
    'grade_junior',
    'grade_senior',
    3,
  ],
  [
    'pos_rider_lead',
    'RIDER-LEAD',
    'Rider supervisor',
    'مشرف مناديب',
    'dept_ops_rid',
    'grade_supervisor',
    'grade_manager',
    1,
  ],
  [
    'pos_rider',
    'RIDER',
    'Rider',
    'مندوب توصيل',
    'dept_ops_rid',
    'grade_junior',
    'grade_senior',
    12,
  ],
  ['pos_qc', 'QC-AGENT', 'QC agent', 'مراقب جودة', 'dept_ops_qc', 'grade_junior', 'grade_lead', 2],
  [
    'pos_com_head',
    'COM-HEAD',
    'Head of commercial',
    'رئيس القطاع التجاري',
    'dept_com',
    'grade_head',
    'grade_director',
    1,
  ],
  ['pos_am', 'AM', 'Account manager', 'مدير حساب', 'dept_com_am', 'grade_mid', 'grade_lead', 2],
  [
    'pos_sales',
    'SALES',
    'Sales executive',
    'مسؤول مبيعات',
    'dept_com_sal',
    'grade_junior',
    'grade_senior',
    2,
  ],
  [
    'pos_fin_mgr',
    'FIN-MGR',
    'Finance manager',
    'المدير المالي',
    'dept_fin',
    'grade_manager',
    'grade_director',
    1,
  ],
  [
    'pos_accountant',
    'ACCOUNTANT',
    'Accountant',
    'محاسب',
    'dept_fin',
    'grade_junior',
    'grade_senior',
    2,
  ],
  [
    'pos_hr_mgr',
    'HR-MGR',
    'HR manager',
    'مدير الموارد البشرية',
    'dept_hr',
    'grade_manager',
    'grade_head',
    1,
  ],
  [
    'pos_hr_officer',
    'HR-OFFICER',
    'HR officer',
    'أخصائي موارد بشرية',
    'dept_hr',
    'grade_junior',
    'grade_senior',
    1,
  ],
  [
    'pos_dev',
    'DEV',
    'Software engineer',
    'مهندس برمجيات',
    'dept_tech',
    'grade_junior',
    'grade_lead',
    2,
  ],
  [
    'pos_cs',
    'CS-AGENT',
    'Customer service agent',
    'ممثل خدمة عملاء',
    'dept_cs',
    'grade_junior',
    'grade_senior',
    3,
  ],
];

type TaskRow = [en: string, ar: string, owner: string, dueDays: number, documentTypeId?: string];
interface TemplateRow {
  id: string;
  code: string;
  kind: 'onboarding' | 'offboarding';
  nameEn: string;
  nameAr: string;
  positionId: string | null;
  tasks: TaskRow[];
}
const COMMON_START: TaskRow[] = [
  ['Collect the national ID copy', 'استلام صورة البطاقة', 'hr', 0, 'doctype_national_id'],
  ['Sign the contract', 'توقيع العقد', 'hr', 0, 'doctype_contract'],
  [
    'Collect the criminal record certificate',
    'استلام الفيش والتشبيه',
    'hr',
    7,
    'doctype_criminal_record',
  ],
  ['Create the Shiply account and access', 'إنشاء الحساب والصلاحيات على شيبلي', 'it', 0],
  ['Register with social insurance', 'التسجيل في التأمينات الاجتماعية', 'hr', 30],
];
export const DEFAULT_CHECKLISTS: TemplateRow[] = [
  {
    id: 'chk_onboarding',
    code: 'ONBOARDING',
    kind: 'onboarding',
    nameEn: 'Onboarding',
    nameAr: 'استقبال موظف جديد',
    positionId: null,
    tasks: [
      ...COMMON_START,
      ['Introduce the team and the workplace', 'التعريف بالفريق ومكان العمل', 'manager', 1],
      ['First week check in', 'متابعة نهاية الأسبوع الأول', 'manager', 7],
      ['End of probation review', 'تقييم نهاية فترة الاختبار', 'manager', 85],
    ],
  },
  {
    id: 'chk_onboarding_store',
    code: 'ONBOARDING-STORE',
    kind: 'onboarding',
    nameEn: 'Store staff onboarding',
    nameAr: 'استقبال موظف مخزن',
    positionId: 'pos_picker',
    tasks: [
      ...COMMON_START,
      ['Give the uniform and the badge', 'تسليم الزي والبطاقة', 'store', 0],
      ['Scanner and picking training', 'تدريب على الماسح والتجهيز', 'manager', 2],
      ['Food safety and handling training', 'تدريب سلامة الغذاء والتعامل مع البضاعة', 'manager', 7],
    ],
  },
  {
    id: 'chk_onboarding_rider',
    code: 'ONBOARDING-RIDER',
    kind: 'onboarding',
    nameEn: 'Rider onboarding',
    nameAr: 'استقبال مندوب جديد',
    positionId: 'pos_rider',
    tasks: [
      ...COMMON_START,
      ['Collect the driving licence', 'استلام رخصة القيادة', 'hr', 0, 'doctype_driving_license'],
      [
        'Give the uniform, the badge and the delivery box',
        'تسليم الزي والبطاقة وصندوق التوصيل',
        'store',
        0,
      ],
      [
        'Rider app and cash handover training',
        'تدريب على تطبيق المندوب وتسليم النقدية',
        'manager',
        1,
      ],
      ['Ride along on the first shift', 'مرافقة في أول وردية', 'manager', 2],
    ],
  },
  {
    id: 'chk_offboarding',
    code: 'OFFBOARDING',
    kind: 'offboarding',
    nameEn: 'Offboarding',
    nameAr: 'إنهاء خدمة',
    positionId: null,
    tasks: [
      ['Take back the badge, uniform and devices', 'استلام البطاقة والزي والأجهزة', 'manager', 0],
      ['Settle cash on hand and staff advances', 'تسوية النقدية والسلف', 'finance', 0],
      ['Close the Shiply account', 'إغلاق الحساب على شيبلي', 'it', 0],
      ['Exit interview', 'مقابلة نهاية الخدمة', 'hr', 0],
      [
        'Final settlement and social insurance form 6',
        'المخالصة النهائية واستمارة 6 تأمينات',
        'hr',
        14,
      ],
    ],
  },
];

/** Creates the default structure rows that are missing (by code). Returns what was added. */
export async function ensureHrDefaults(db: Db) {
  let added = 0;
  for (const [id, code, nameEn, nameAr, parentId, sort] of DEFAULT_DEPARTMENTS) {
    if (await db.department.findUnique({ where: { code } })) continue;
    const parent = parentId ? await db.department.findUnique({ where: { id: parentId } }) : null;
    await db.department.create({
      data: { id, code, nameEn, nameAr, parentId: parent?.id ?? null, sort },
    });
    added++;
  }
  for (const [id, code, nameEn, nameAr, rank] of DEFAULT_GRADES) {
    if (await db.grade.findUnique({ where: { code } })) continue;
    if (await db.grade.findUnique({ where: { rank } })) continue;
    await db.grade.create({ data: { id, code, nameEn, nameAr, rank } });
    added++;
  }
  for (const t of DEFAULT_DOCUMENT_TYPES) {
    if (await db.employeeDocumentType.findUnique({ where: { code: t.code } })) continue;
    const departments = await db.department.findMany({
      where: { id: { in: t.requiredDepartmentIds ?? [] } },
      select: { id: true },
    });
    await db.employeeDocumentType.create({
      data: {
        id: t.id,
        code: t.code,
        nameEn: t.nameEn,
        nameAr: t.nameAr,
        hasExpiry: t.hasExpiry,
        required: t.required,
        requiredEmployment: t.requiredEmployment ?? [],
        requiredDepartmentIds: departments.map((d) => d.id),
        confidential: t.confidential ?? false,
        selfUpload: t.selfUpload ?? true,
        multiple: t.multiple ?? false,
        sort: t.sort,
      },
    });
    added++;
  }
  for (const [id, code, titleEn, titleAr, departmentId, min, max, planned] of DEFAULT_POSITIONS) {
    if (await db.jobPosition.findUnique({ where: { code } })) continue;
    if (!(await db.department.findUnique({ where: { id: departmentId } }))) continue;
    const grades = await db.grade.findMany({ where: { id: { in: [min, max] } } });
    await db.jobPosition.create({
      data: {
        id,
        code,
        titleEn,
        titleAr,
        departmentId,
        minGradeId: grades.some((g) => g.id === min) ? min : null,
        maxGradeId: grades.some((g) => g.id === max) ? max : null,
        headcountPlanned: planned,
      },
    });
    added++;
  }
  for (const t of DEFAULT_CHECKLISTS) {
    if (await db.checklistTemplate.findUnique({ where: { code: t.code } })) continue;
    const position = t.positionId
      ? await db.jobPosition.findUnique({ where: { id: t.positionId } })
      : null;
    const types = new Set(
      (await db.employeeDocumentType.findMany({ select: { id: true } })).map((x) => x.id),
    );
    await db.checklistTemplate.create({
      data: {
        id: t.id,
        code: t.code,
        kind: t.kind,
        nameEn: t.nameEn,
        nameAr: t.nameAr,
        positionId: position?.id ?? null,
        tasks: {
          create: t.tasks.map(([titleEn, titleAr, ownerRole, dueDays, documentTypeId], sort) => ({
            titleEn,
            titleAr,
            ownerRole,
            dueDays,
            documentTypeId: documentTypeId && types.has(documentTypeId) ? documentTypeId : null,
            sort,
          })),
        },
      },
    });
    added++;
  }
  return added;
}

/**
 * Places seeded and demo people in the organisation so the org chart means something: the
 * first admin is the chief executive and heads Management, the first finance person heads
 * Finance, the first store person heads Dark stores and the first person of each store
 * manages it, riders report to their store's manager. Only empty fields are filled, so HR's
 * own choices are never overwritten.
 */
export async function placeSeedPeople(db: Db) {
  const people = await db.employee.findMany({
    where: { status: { not: 'left' } },
    include: {
      user: { select: { role: true, access: { select: { jobRole: true } } } },
      homeStore: { select: { id: true, kind: true } },
    },
    orderBy: [{ number: 'asc' }],
  });
  const ids = async (rows: Promise<{ id: string }[]>) => new Set((await rows).map((r) => r.id));
  const positions = await ids(db.jobPosition.findMany({ select: { id: true } }));
  const grades = await ids(db.grade.findMany({ select: { id: true } }));
  const departments = await ids(db.department.findMany({ select: { id: true } }));
  if (!positions.has('pos_ceo') || !grades.has('grade_chief') || !departments.has('dept_mgt'))
    return 0;
  const byJob: Record<string, [string, string, string]> = {
    owner: ['pos_ceo', 'grade_chief', 'dept_mgt'],
    operations_manager: ['pos_coo', 'grade_head', 'dept_ops'],
    hr_manager: ['pos_hr_mgr', 'grade_manager', 'dept_hr'],
    hr_officer: ['pos_hr_officer', 'grade_mid', 'dept_hr'],
    account_manager: ['pos_am', 'grade_mid', 'dept_com_am'],
    customer_service: ['pos_cs', 'grade_junior', 'dept_cs'],
    finance_manager: ['pos_fin_mgr', 'grade_manager', 'dept_fin'],
    finance_officer: ['pos_accountant', 'grade_senior', 'dept_fin'],
    accountant: ['pos_accountant', 'grade_mid', 'dept_fin'],
  };
  const heading: Record<string, string> = {
    pos_ceo: 'dept_mgt',
    pos_fin_mgr: 'dept_fin',
    pos_hr_mgr: 'dept_hr',
    pos_coo: 'dept_ops',
  };
  const storeManager = new Map<string, string>();
  const heads = new Map<string, string>();
  let placed = 0;
  let n = 0;
  for (const p of people) {
    n++;
    const role = p.user.role;
    const job = p.user.access?.jobRole ?? '';
    const store = p.homeStore;
    let place: [string, string, string] | null = null;
    let manager: string | null = null;
    if (role === 'admin' && !heads.has('dept_mgt')) place = byJob.owner!;
    else if (role === 'finance' && !heads.has('dept_fin')) place = byJob.finance_manager!;
    else if (role === 'admin' || role === 'finance') {
      place = byJob[job] ?? (role === 'finance' ? byJob.accountant! : byJob.operations_manager!);
      // A department has one head: a second finance manager is a senior accountant.
      const led = heading[place[0]];
      if (led && heads.has(led) && role === 'finance')
        place = ['pos_accountant', 'grade_senior', 'dept_fin'];
    } else if (role === 'store_staff' && store?.kind === 'hub')
      place = ['pos_hub_staff', n % 2 ? 'grade_junior' : 'grade_mid', 'dept_ops_hub'];
    else if (role === 'store_staff' && store) {
      if (!storeManager.has(store.id)) {
        place = ['pos_store_mgr', 'grade_supervisor', 'dept_ops_ds'];
        storeManager.set(store.id, p.id);
      } else {
        place = ['pos_picker', n % 2 ? 'grade_junior' : 'grade_mid', 'dept_ops_ds'];
        manager = storeManager.get(store.id)!;
      }
    } else if (role === 'rider') {
      place = ['pos_rider', ['grade_junior', 'grade_mid', 'grade_senior'][n % 3]!, 'dept_ops_rid'];
      manager = store ? (storeManager.get(store.id) ?? null) : null;
    }
    if (!place) continue;
    const [positionId, gradeId, departmentId] = place;
    // The first person of each leading role heads their department.
    const headOf =
      heading[positionId] ??
      (positionId === 'pos_store_mgr' && !heads.has('dept_ops_ds') ? 'dept_ops_ds' : null);
    if (headOf && !heads.has(headOf)) heads.set(headOf, p.id);
    if (p.positionId) continue;
    await db.employee.update({
      where: { id: p.id },
      data: {
        positionId: positions.has(positionId) ? positionId : null,
        gradeId: grades.has(gradeId) ? gradeId : null,
        departmentId: departments.has(departmentId) ? departmentId : p.departmentId,
        managerId: p.managerId ?? (manager && manager !== p.id ? manager : null),
      },
    });
    placed++;
  }
  for (const [departmentId, employeeId] of heads)
    await db.department.updateMany({
      where: { id: departmentId, headEmployeeId: null },
      data: { headEmployeeId: employeeId },
    });
  return placed;
}
