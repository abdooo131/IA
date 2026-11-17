-- HR step 1 (docs/HR.md): employee files linked 1:1 to users, their documents, an hr app in
-- the access profile, account managers for merchants (merchants.account_manager_id and
-- user_access.own_merchants_only) and keyed alerts that are not tied to an order.
-- staff_salaries.national_id and insurance_number move to the employee file.

-- CreateEnum
CREATE TYPE "employee_status" AS ENUM ('active', 'on_leave', 'suspended', 'left');

-- CreateEnum
CREATE TYPE "contract_type" AS ENUM ('permanent', 'fixed_term', 'part_time', 'outsourced');

-- CreateEnum
CREATE TYPE "employee_document_kind" AS ENUM ('national_id', 'contract', 'criminal_record', 'military_status', 'qualification', 'medical', 'other');

-- AlterTable
ALTER TABLE "alerts" ADD COLUMN     "key" TEXT,
ADD COLUMN     "merchant_id" TEXT;

-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "account_manager_id" TEXT;

-- AlterTable
ALTER TABLE "user_access" ADD COLUMN     "hr" "access_level" NOT NULL DEFAULT 'none',
ADD COLUMN     "own_merchants_only" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT,
    "national_id" TEXT,
    "national_id_expires_on" DATE,
    "birth_date" DATE,
    "address" TEXT,
    "emergency_name" TEXT,
    "emergency_phone" TEXT,
    "job_title" TEXT,
    "department" TEXT,
    "manager_id" TEXT,
    "home_store_id" TEXT,
    "hire_date" DATE,
    "contract_type" "contract_type" NOT NULL DEFAULT 'permanent',
    "contract_ends_on" DATE,
    "probation_ends_on" DATE,
    "social_insurance_number" TEXT,
    "bank_name" TEXT,
    "bank_account_number" TEXT,
    "iban" TEXT,
    "bank_account_holder" TEXT,
    "status" "employee_status" NOT NULL DEFAULT 'active',
    "left_on" DATE,
    "left_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_documents" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "kind" "employee_document_kind" NOT NULL,
    "title" TEXT,
    "content_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "issued_on" DATE,
    "expires_on" DATE,
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_number_key" ON "employees"("number");

-- CreateIndex
CREATE UNIQUE INDEX "employees_user_id_key" ON "employees"("user_id");

-- CreateIndex
CREATE INDEX "employees_home_store_id_idx" ON "employees"("home_store_id");

-- CreateIndex
CREATE INDEX "employees_status_idx" ON "employees"("status");

-- CreateIndex
CREATE INDEX "employee_documents_employee_id_idx" ON "employee_documents"("employee_id");

-- CreateIndex
CREATE INDEX "employee_documents_expires_on_idx" ON "employee_documents"("expires_on");

-- CreateIndex
CREATE UNIQUE INDEX "alerts_key_key" ON "alerts"("key");

-- CreateIndex
CREATE INDEX "merchants_account_manager_id_idx" ON "merchants"("account_manager_id");

-- AddForeignKey
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_account_manager_id_fkey" FOREIGN KEY ("account_manager_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_home_store_id_fkey" FOREIGN KEY ("home_store_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Rules Prisma cannot express ─────────────────────────────────────────────────

ALTER TABLE "employees" ADD CONSTRAINT "employees_national_id_check"
  CHECK ("national_id" IS NULL OR "national_id" ~ '^[0-9]{14}$');
ALTER TABLE "employees" ADD CONSTRAINT "employees_left_check"
  CHECK ("status" <> 'left' OR ("left_on" IS NOT NULL AND "left_reason" IS NOT NULL));
ALTER TABLE "employees" ADD CONSTRAINT "employees_not_own_manager_check"
  CHECK ("manager_id" IS NULL OR "manager_id" <> "id");
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_check"
  CHECK ("department" IS NULL OR "department" IN ('management', 'operations', 'store',
    'delivery', 'merchants', 'finance', 'hr', 'quality', 'other'));
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_size_check"
  CHECK ("size_bytes" > 0 AND "size_bytes" <= 3000000);
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_type_check"
  CHECK ("content_type" IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf'));

-- ─── Moving existing people ──────────────────────────────────────────────────────

-- Every team member and rider gets a file from what their account already holds.
INSERT INTO "employees" ("id", "user_id", "name_en", "home_store_id", "contract_type",
  "status", "hire_date", "created_at", "updated_at")
SELECT 'emp_' || u."id", u."id", u."name",
  CASE WHEN u."role" IN ('store_staff', 'rider')
    THEN COALESCE(u."dark_store_id", r."dark_store_id") END,
  CASE u."employment" WHEN 'outsourced' THEN 'outsourced'::"contract_type"
    ELSE 'permanent'::"contract_type" END,
  CASE WHEN u."is_active" THEN 'active'::"employee_status" ELSE 'suspended'::"employee_status" END,
  (u."created_at" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo')::date,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users" u
LEFT JOIN "riders" r ON r."user_id" = u."id"
WHERE u."role" IN ('admin', 'finance', 'store_staff', 'rider')
ORDER BY u."created_at", u."id";

-- National ID and insurance number move from the salary row to the file.
UPDATE "employees" e
SET "national_id" = s."national_id", "social_insurance_number" = s."insurance_number"
FROM "staff_salaries" s
WHERE s."user_id" = e."user_id";

ALTER TABLE "staff_salaries" DROP COLUMN "insurance_number",
DROP COLUMN "national_id";

-- The owner profile reaches the new HR app.
UPDATE "user_access" SET "hr" = 'manage' WHERE "job_role" = 'owner';

-- Merchant sign up alerts already raised name their merchant.
UPDATE "alerts" SET "merchant_id" = "data"->>'merchantId'
WHERE "type" = 'merchant_signup' AND "data" ? 'merchantId'
  AND EXISTS (SELECT 1 FROM "merchants" m WHERE m."id" = "data"->>'merchantId');
