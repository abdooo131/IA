-- HR v2 (docs/HR.md "HR v2 as built"): HR owns people, Accounting only pays.
-- Departments as a tree, grades, job positions, the employee photo, document types with
-- versions and verification, salary packages with allowances and history (replacing
-- staff_salaries), employment and staffing supplier moved from users to the employee file,
-- onboarding and offboarding checklists.

-- CreateEnum
CREATE TYPE "employee_document_status" AS ENUM ('pending', 'verified', 'rejected');

-- CreateEnum
CREATE TYPE "allowance_kind" AS ENUM ('housing', 'transport', 'phone', 'other');

-- CreateEnum
CREATE TYPE "checklist_kind" AS ENUM ('onboarding', 'offboarding');

-- CreateEnum
CREATE TYPE "checklist_status" AS ENUM ('open', 'done', 'cancelled');

-- CreateTable
CREATE TABLE "employee_photos" (
    "employee_id" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_photos_pkey" PRIMARY KEY ("employee_id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "parent_id" TEXT,
    "head_employee_id" TEXT,
    "cost_store_id" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grades" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "band_min_piastres" INTEGER,
    "band_max_piastres" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_positions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title_en" TEXT NOT NULL,
    "title_ar" TEXT NOT NULL,
    "department_id" TEXT NOT NULL,
    "min_grade_id" TEXT,
    "max_grade_id" TEXT,
    "headcount_planned" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_document_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "has_expiry" BOOLEAN NOT NULL DEFAULT false,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "required_employment" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required_department_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required_position_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowed_types" TEXT[] DEFAULT ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::TEXT[],
    "max_bytes" INTEGER NOT NULL DEFAULT 3000000,
    "confidential" BOOLEAN NOT NULL DEFAULT false,
    "self_upload" BOOLEAN NOT NULL DEFAULT true,
    "multiple" BOOLEAN NOT NULL DEFAULT false,
    "alert_days" INTEGER,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_document_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_packages" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "basic_piastres" INTEGER NOT NULL,
    "insured_wage_piastres" INTEGER,
    "note" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salary_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_allowances" (
    "id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "kind" "allowance_kind" NOT NULL,
    "label" TEXT,
    "amount_piastres" INTEGER NOT NULL,

    CONSTRAINT "salary_allowances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_templates" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "checklist_kind" NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "position_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_template_tasks" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "title_en" TEXT NOT NULL,
    "title_ar" TEXT NOT NULL,
    "owner_role" TEXT NOT NULL,
    "due_days" INTEGER NOT NULL DEFAULT 0,
    "document_type_id" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "checklist_template_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_checklists" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "template_id" TEXT,
    "kind" "checklist_kind" NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "starts_on" DATE NOT NULL,
    "status" "checklist_status" NOT NULL DEFAULT 'open',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_checklist_tasks" (
    "id" TEXT NOT NULL,
    "checklist_id" TEXT NOT NULL,
    "title_en" TEXT NOT NULL,
    "title_ar" TEXT NOT NULL,
    "owner_role" TEXT NOT NULL,
    "due_on" DATE NOT NULL,
    "document_type_id" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "done_at" TIMESTAMP(3),
    "done_by_id" TEXT,
    "note" TEXT,

    CONSTRAINT "employee_checklist_tasks_pkey" PRIMARY KEY ("id")
);

-- AlterTable: the new columns of the file and of documents (filled below)
ALTER TABLE "employees" ADD COLUMN "department_id" TEXT,
ADD COLUMN "employment" "employment_type" NOT NULL DEFAULT 'employee',
ADD COLUMN "grade_id" TEXT,
ADD COLUMN "position_id" TEXT,
ADD COLUMN "staffing_supplier_id" TEXT;

ALTER TABLE "employee_documents" ADD COLUMN "is_current" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "previous_id" TEXT,
ADD COLUMN "review_note" TEXT,
ADD COLUMN "reviewed_at" TIMESTAMP(3),
ADD COLUMN "reviewed_by_id" TEXT,
ADD COLUMN "self_uploaded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "status" "employee_document_status" NOT NULL DEFAULT 'pending',
ADD COLUMN "type_id" TEXT,
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- ─── Default structure (the seed adds positions and checklists; ids are fixed) ─────

INSERT INTO "departments" ("id", "code", "name_en", "name_ar", "parent_id", "sort", "updated_at") VALUES
  ('dept_mgt', 'MGT', 'Management', 'الإدارة العليا', NULL, 0, CURRENT_TIMESTAMP),
  ('dept_ops', 'OPS', 'Operations', 'العمليات', 'dept_mgt', 1, CURRENT_TIMESTAMP),
  ('dept_ops_ds', 'OPS-DS', 'Dark stores', 'المخازن المظلمة', 'dept_ops', 1, CURRENT_TIMESTAMP),
  ('dept_ops_hub', 'OPS-HUB', 'Hub', 'مركز الفرز', 'dept_ops', 2, CURRENT_TIMESTAMP),
  ('dept_ops_rid', 'OPS-RID', 'Riders', 'المناديب', 'dept_ops', 3, CURRENT_TIMESTAMP),
  ('dept_ops_qc', 'OPS-QC', 'Quality control', 'مراقبة الجودة', 'dept_ops', 4, CURRENT_TIMESTAMP),
  ('dept_com', 'COM', 'Commercial', 'التجاري', 'dept_mgt', 2, CURRENT_TIMESTAMP),
  ('dept_com_am', 'COM-AM', 'Account management', 'إدارة حسابات التجار', 'dept_com', 1, CURRENT_TIMESTAMP),
  ('dept_com_sal', 'COM-SAL', 'Sales', 'المبيعات', 'dept_com', 2, CURRENT_TIMESTAMP),
  ('dept_fin', 'FIN', 'Finance', 'المالية', 'dept_mgt', 3, CURRENT_TIMESTAMP),
  ('dept_hr', 'HR', 'Human resources', 'الموارد البشرية', 'dept_mgt', 4, CURRENT_TIMESTAMP),
  ('dept_tech', 'TECH', 'Technology', 'التكنولوجيا', 'dept_mgt', 5, CURRENT_TIMESTAMP),
  ('dept_cs', 'CS', 'Customer service', 'خدمة العملاء', 'dept_mgt', 6, CURRENT_TIMESTAMP);

INSERT INTO "grades" ("id", "code", "name_en", "name_ar", "rank", "updated_at") VALUES
  ('grade_intern', 'INTERN', 'Intern', 'متدرب', 1, CURRENT_TIMESTAMP),
  ('grade_junior', 'JUNIOR', 'Junior', 'مبتدئ', 2, CURRENT_TIMESTAMP),
  ('grade_mid', 'MID', 'Mid level', 'متوسط الخبرة', 3, CURRENT_TIMESTAMP),
  ('grade_senior', 'SENIOR', 'Senior', 'خبير', 4, CURRENT_TIMESTAMP),
  ('grade_lead', 'LEAD', 'Lead', 'قائد فريق', 5, CURRENT_TIMESTAMP),
  ('grade_supervisor', 'SUPERVISOR', 'Supervisor', 'مشرف', 6, CURRENT_TIMESTAMP),
  ('grade_manager', 'MANAGER', 'Manager', 'مدير', 7, CURRENT_TIMESTAMP),
  ('grade_head', 'HEAD', 'Head', 'رئيس قسم', 8, CURRENT_TIMESTAMP),
  ('grade_director', 'DIRECTOR', 'Director', 'مدير إدارة', 9, CURRENT_TIMESTAMP),
  ('grade_chief', 'CHIEF', 'Chief (C level)', 'رئيس تنفيذي', 10, CURRENT_TIMESTAMP);

-- The step 1 document kinds become document types (their ids are doctype_<kind>).
INSERT INTO "employee_document_types" ("id", "code", "name_en", "name_ar", "has_expiry",
  "required", "required_employment", "required_department_ids", "confidential", "self_upload",
  "multiple", "sort", "updated_at") VALUES
  ('doctype_national_id', 'national_id', 'National ID copy', 'صورة البطاقة', true, true, ARRAY[]::TEXT[], ARRAY[]::TEXT[], false, true, false, 1, CURRENT_TIMESTAMP),
  ('doctype_contract', 'contract', 'Signed contract', 'العقد الموقع', false, true, ARRAY['employee']::TEXT[], ARRAY[]::TEXT[], true, false, false, 2, CURRENT_TIMESTAMP),
  ('doctype_criminal_record', 'criminal_record', 'Criminal record certificate', 'فيش وتشبيه', true, true, ARRAY[]::TEXT[], ARRAY[]::TEXT[], false, true, false, 3, CURRENT_TIMESTAMP),
  ('doctype_military_status', 'military_status', 'Military status', 'الموقف من التجنيد', false, false, ARRAY[]::TEXT[], ARRAY[]::TEXT[], false, true, false, 4, CURRENT_TIMESTAMP),
  ('doctype_qualification', 'qualification', 'Qualification', 'المؤهل الدراسي', false, false, ARRAY[]::TEXT[], ARRAY[]::TEXT[], false, true, true, 5, CURRENT_TIMESTAMP),
  ('doctype_medical', 'medical', 'Medical certificate', 'شهادة طبية', true, false, ARRAY[]::TEXT[], ARRAY[]::TEXT[], true, true, false, 6, CURRENT_TIMESTAMP),
  ('doctype_driving_license', 'driving_license', 'Driving licence', 'رخصة القيادة', true, true, ARRAY[]::TEXT[], ARRAY['dept_ops_rid']::TEXT[], false, true, false, 7, CURRENT_TIMESTAMP),
  ('doctype_other', 'other', 'Other', 'أخرى', false, false, ARRAY[]::TEXT[], ARRAY[]::TEXT[], false, true, true, 99, CURRENT_TIMESTAMP);

-- ─── Moving existing data ────────────────────────────────────────────────────────

-- The old department words become departments; people without one get one from their role.
UPDATE "employees" e SET "department_id" = CASE e."department"
    WHEN 'management' THEN 'dept_mgt'
    WHEN 'operations' THEN 'dept_ops'
    WHEN 'store' THEN 'dept_ops_ds'
    WHEN 'delivery' THEN 'dept_ops_rid'
    WHEN 'merchants' THEN 'dept_com_am'
    WHEN 'finance' THEN 'dept_fin'
    WHEN 'hr' THEN 'dept_hr'
    WHEN 'quality' THEN 'dept_ops_qc'
  END;
UPDATE "employees" e SET "department_id" = CASE
    WHEN u."role" = 'rider' THEN 'dept_ops_rid'
    WHEN u."role" = 'store_staff' AND s."kind" = 'hub' THEN 'dept_ops_hub'
    WHEN u."role" = 'store_staff' THEN 'dept_ops_ds'
    WHEN u."role" = 'finance' THEN 'dept_fin'
  END
FROM "users" u LEFT JOIN "dark_stores" s ON s."id" = u."dark_store_id"
WHERE u."id" = e."user_id" AND e."department_id" IS NULL AND e."department" IS NULL;

-- Employment and the outsourcing company move from the account to the file.
UPDATE "employees" e SET "employment" = u."employment", "staffing_supplier_id" = u."staffing_supplier_id"
FROM "users" u WHERE u."id" = e."user_id";

-- Each salary becomes the person's first package (no history existed before).
INSERT INTO "salary_packages" ("id", "employee_id", "effective_from", "basic_piastres",
  "insured_wage_piastres", "note", "created_by_id", "created_at")
SELECT 'pkg_' || e."id", e."id",
  LEAST(COALESCE(e."hire_date", (s."updated_at" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo')::date),
        (s."updated_at" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo')::date),
  s."monthly_piastres", s."insured_wage_piastres", 'Moved from payroll', s."updated_by_id", s."updated_at"
FROM "staff_salaries" s JOIN "employees" e ON e."user_id" = s."user_id";

-- Documents: each kind becomes its type; HR uploaded them, so they count as verified.
UPDATE "employee_documents" SET "type_id" = 'doctype_' || "kind"::text,
  "status" = 'verified', "reviewed_by_id" = "uploaded_by_id", "reviewed_at" = "created_at";
-- Several documents of a single type on one file: the newest is current, the others its versions.
WITH v AS (
  SELECT d."id",
    ROW_NUMBER() OVER (PARTITION BY d."employee_id", d."type_id" ORDER BY d."created_at", d."id") AS n,
    COUNT(*) OVER (PARTITION BY d."employee_id", d."type_id") AS total,
    LAG(d."id") OVER (PARTITION BY d."employee_id", d."type_id" ORDER BY d."created_at", d."id") AS prev
  FROM "employee_documents" d
  JOIN "employee_document_types" t ON t."id" = d."type_id" AND NOT t."multiple"
)
UPDATE "employee_documents" d SET "version" = v.n, "previous_id" = v.prev, "is_current" = (v.n = v.total)
FROM v WHERE v."id" = d."id";

ALTER TABLE "employee_documents" ALTER COLUMN "type_id" SET NOT NULL;
ALTER TABLE "employee_documents" DROP COLUMN "kind";
DROP TYPE "employee_document_kind";
ALTER TABLE "employees" DROP COLUMN "department";

-- staff_salaries and the account's employment are replaced by the HR tables.
ALTER TABLE "staff_salaries" DROP CONSTRAINT "staff_salaries_updated_by_id_fkey";
ALTER TABLE "staff_salaries" DROP CONSTRAINT "staff_salaries_user_id_fkey";
DROP TABLE "staff_salaries";
ALTER TABLE "users" DROP CONSTRAINT "users_staffing_supplier_id_fkey";
ALTER TABLE "users" DROP COLUMN "employment", DROP COLUMN "staffing_supplier_id";

-- ─── Indexes and keys ────────────────────────────────────────────────────────────

CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");
CREATE INDEX "departments_parent_id_idx" ON "departments"("parent_id");
CREATE UNIQUE INDEX "grades_code_key" ON "grades"("code");
CREATE UNIQUE INDEX "grades_rank_key" ON "grades"("rank");
CREATE UNIQUE INDEX "job_positions_code_key" ON "job_positions"("code");
CREATE INDEX "job_positions_department_id_idx" ON "job_positions"("department_id");
CREATE UNIQUE INDEX "employee_document_types_code_key" ON "employee_document_types"("code");
CREATE UNIQUE INDEX "salary_packages_employee_id_effective_from_key" ON "salary_packages"("employee_id", "effective_from");
CREATE INDEX "salary_allowances_package_id_idx" ON "salary_allowances"("package_id");
CREATE UNIQUE INDEX "checklist_templates_code_key" ON "checklist_templates"("code");
CREATE INDEX "checklist_template_tasks_template_id_idx" ON "checklist_template_tasks"("template_id");
CREATE INDEX "employee_checklists_employee_id_idx" ON "employee_checklists"("employee_id");
CREATE INDEX "employee_checklist_tasks_checklist_id_idx" ON "employee_checklist_tasks"("checklist_id");
CREATE UNIQUE INDEX "employee_documents_previous_id_key" ON "employee_documents"("previous_id");
CREATE INDEX "employee_documents_type_id_idx" ON "employee_documents"("type_id");
CREATE INDEX "employees_department_id_idx" ON "employees"("department_id");
CREATE INDEX "employees_manager_id_idx" ON "employees"("manager_id");

ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "job_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employees" ADD CONSTRAINT "employees_staffing_supplier_id_fkey" FOREIGN KEY ("staffing_supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_photos" ADD CONSTRAINT "employee_photos_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "departments" ADD CONSTRAINT "departments_head_employee_id_fkey" FOREIGN KEY ("head_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "departments" ADD CONSTRAINT "departments_cost_store_id_fkey" FOREIGN KEY ("cost_store_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "job_positions" ADD CONSTRAINT "job_positions_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "job_positions" ADD CONSTRAINT "job_positions_min_grade_id_fkey" FOREIGN KEY ("min_grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "job_positions" ADD CONSTRAINT "job_positions_max_grade_id_fkey" FOREIGN KEY ("max_grade_id") REFERENCES "grades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "employee_document_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_previous_id_fkey" FOREIGN KEY ("previous_id") REFERENCES "employee_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "salary_packages" ADD CONSTRAINT "salary_packages_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "salary_packages" ADD CONSTRAINT "salary_packages_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "salary_allowances" ADD CONSTRAINT "salary_allowances_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "salary_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "job_positions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "checklist_template_tasks" ADD CONSTRAINT "checklist_template_tasks_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "checklist_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "checklist_template_tasks" ADD CONSTRAINT "checklist_template_tasks_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "employee_document_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_checklists" ADD CONSTRAINT "employee_checklists_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_checklists" ADD CONSTRAINT "employee_checklists_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "checklist_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_checklists" ADD CONSTRAINT "employee_checklists_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_checklist_tasks" ADD CONSTRAINT "employee_checklist_tasks_checklist_id_fkey" FOREIGN KEY ("checklist_id") REFERENCES "employee_checklists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_checklist_tasks" ADD CONSTRAINT "employee_checklist_tasks_done_by_id_fkey" FOREIGN KEY ("done_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Rules Prisma cannot express ─────────────────────────────────────────────────

ALTER TABLE "departments" ADD CONSTRAINT "departments_not_own_parent_check"
  CHECK ("parent_id" IS NULL OR "parent_id" <> "id");
ALTER TABLE "grades" ADD CONSTRAINT "grades_band_check"
  CHECK ("rank" > 0
    AND ("band_min_piastres" IS NULL OR "band_min_piastres" >= 0)
    AND ("band_max_piastres" IS NULL OR "band_max_piastres" >= 0)
    AND ("band_min_piastres" IS NULL OR "band_max_piastres" IS NULL
      OR "band_min_piastres" <= "band_max_piastres"));
ALTER TABLE "job_positions" ADD CONSTRAINT "job_positions_headcount_check"
  CHECK ("headcount_planned" >= 0);
ALTER TABLE "employee_document_types" ADD CONSTRAINT "employee_document_types_size_check"
  CHECK ("max_bytes" > 0 AND "max_bytes" <= 3000000
    AND ("alert_days" IS NULL OR ("alert_days" >= 0 AND "alert_days" <= 365)));
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_review_check"
  CHECK ("status" = 'pending' OR "reviewed_at" IS NOT NULL);
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_version_check"
  CHECK ("version" >= 1);
ALTER TABLE "employee_photos" ADD CONSTRAINT "employee_photos_check"
  CHECK ("size_bytes" > 0 AND "size_bytes" <= 1000000
    AND "content_type" IN ('image/jpeg', 'image/png', 'image/webp'));
ALTER TABLE "salary_packages" ADD CONSTRAINT "salary_packages_amounts_check"
  CHECK ("basic_piastres" >= 0 AND ("insured_wage_piastres" IS NULL OR "insured_wage_piastres" >= 0));
ALTER TABLE "salary_allowances" ADD CONSTRAINT "salary_allowances_amount_check"
  CHECK ("amount_piastres" >= 0);
ALTER TABLE "employees" ADD CONSTRAINT "employees_outsourced_check"
  CHECK ("employment" = 'employee' OR "staffing_supplier_id" IS NOT NULL);
