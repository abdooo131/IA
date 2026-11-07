-- HR phase 3 (docs/HR.md "Phase 3 as built"): leave types, requests (two step approval),
-- balances from adjustments and approved days, violations with an escalation ladder, suggested
-- violations from attendance, and attendance correction requests.

-- CreateEnum
CREATE TYPE "leave_balance_kind" AS ENUM ('annual', 'own', 'none');

-- CreateEnum
CREATE TYPE "leave_request_status" AS ENUM ('pending_manager', 'pending_hr', 'approved', 'rejected', 'cancelled');

-- CreateEnum
CREATE TYPE "violation_category" AS ENUM ('attendance', 'conduct', 'cash', 'damage', 'safety');

-- CreateEnum
CREATE TYPE "penalty_kind" AS ENUM ('verbal_warning', 'written_warning', 'deduction_days', 'deduction_amount', 'suspension_days', 'termination_review');

-- CreateEnum
CREATE TYPE "violation_status" AS ENUM ('recorded', 'appealed', 'final', 'cancelled');

-- CreateEnum
CREATE TYPE "correction_status" AS ENUM ('pending_manager', 'pending_hr', 'applied', 'rejected', 'cancelled');



-- AlterTable
ALTER TABLE "grades" ADD COLUMN     "annual_leave_days" INTEGER;

-- AlterTable
ALTER TABLE "job_positions" ADD COLUMN     "annual_leave_days" INTEGER;

-- CreateTable
CREATE TABLE "leave_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "balance" "leave_balance_kind" NOT NULL DEFAULT 'annual',
    "yearly_days" DECIMAL(6,2),
    "casual_allowance" BOOLEAN NOT NULL DEFAULT false,
    "document_above_days" INTEGER,
    "max_days_per_request" INTEGER,
    "notice_days" INTEGER NOT NULL DEFAULT 0,
    "self_request" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "employee_id" TEXT NOT NULL,
    "type_id" TEXT NOT NULL,
    "from_day" DATE NOT NULL,
    "to_day" DATE NOT NULL,
    "half_day" BOOLEAN NOT NULL DEFAULT false,
    "days" DECIMAL(6,2) NOT NULL,
    "note" TEXT,
    "status" "leave_request_status" NOT NULL,
    "manager_employee_id" TEXT,
    "requested_by_id" TEXT NOT NULL,
    "on_behalf" BOOLEAN NOT NULL DEFAULT false,
    "override_balance" BOOLEAN NOT NULL DEFAULT false,
    "override_backdate" BOOLEAN NOT NULL DEFAULT false,
    "document_content_type" TEXT,
    "document_data" BYTEA,
    "document_name" TEXT,
    "manager_decided_by_id" TEXT,
    "manager_decided_at" TIMESTAMP(3),
    "hr_decided_by_id" TEXT,
    "hr_decided_at" TIMESTAMP(3),
    "rejected_by_id" TEXT,
    "rejected_at" TIMESTAMP(3),
    "reject_reason" TEXT,
    "cancelled_by_id" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_request_days" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "fraction" DECIMAL(3,2) NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "payroll_entry_id" TEXT,
    "deduction_piastres" INTEGER,

    CONSTRAINT "leave_request_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_adjustments" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "type_id" TEXT,
    "year" INTEGER NOT NULL,
    "days" DECIMAL(6,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "violation_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "category" "violation_category" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "violation_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "violation_steps" (
    "id" TEXT NOT NULL,
    "type_id" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "penalty" "penalty_kind" NOT NULL,
    "days" DECIMAL(6,2),
    "amount_piastres" INTEGER,

    CONSTRAINT "violation_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "violations" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "employee_id" TEXT NOT NULL,
    "type_id" TEXT NOT NULL,
    "occurred_on" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "suggested_step" INTEGER NOT NULL,
    "step" INTEGER NOT NULL,
    "step_reason" TEXT,
    "penalty" "penalty_kind" NOT NULL,
    "days" DECIMAL(6,2),
    "amount_piastres" INTEGER,
    "status" "violation_status" NOT NULL DEFAULT 'recorded',
    "recorded_by_id" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appeal_reason" TEXT,
    "appealed_at" TIMESTAMP(3),
    "decision" TEXT,
    "decision_note" TEXT,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "final_at" TIMESTAMP(3),
    "evidence_content_type" TEXT,
    "evidence_data" BYTEA,
    "evidence_name" TEXT,
    "payroll_entry_id" TEXT,
    "deduction_piastres" INTEGER,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "violations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "violation_suggestions" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "late_minutes" INTEGER NOT NULL DEFAULT 0,
    "type_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "violation_id" TEXT,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "violation_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_corrections" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "employee_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "problem" TEXT NOT NULL,
    "proposed_in" TIMESTAMP(3),
    "proposed_out" TIMESTAMP(3),
    "status" "correction_status" NOT NULL,
    "manager_employee_id" TEXT,
    "requested_by_id" TEXT NOT NULL,
    "manager_decided_by_id" TEXT,
    "manager_decided_at" TIMESTAMP(3),
    "hr_decided_by_id" TEXT,
    "hr_decided_at" TIMESTAMP(3),
    "rejected_by_id" TEXT,
    "rejected_at" TIMESTAMP(3),
    "reject_reason" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "punch_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_code_key" ON "leave_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "leave_requests_number_key" ON "leave_requests"("number");

-- CreateIndex
CREATE UNIQUE INDEX "leave_requests_idempotency_key_key" ON "leave_requests"("idempotency_key");

-- CreateIndex
CREATE INDEX "leave_requests_employee_id_from_day_idx" ON "leave_requests"("employee_id", "from_day");

-- CreateIndex
CREATE INDEX "leave_requests_status_idx" ON "leave_requests"("status");

-- CreateIndex
CREATE INDEX "leave_request_days_employee_id_day_idx" ON "leave_request_days"("employee_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "leave_request_days_request_id_day_key" ON "leave_request_days"("request_id", "day");

-- CreateIndex
CREATE INDEX "leave_adjustments_employee_id_year_idx" ON "leave_adjustments"("employee_id", "year");

-- CreateIndex
CREATE UNIQUE INDEX "violation_types_code_key" ON "violation_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "violation_steps_type_id_step_key" ON "violation_steps"("type_id", "step");

-- CreateIndex
CREATE UNIQUE INDEX "violations_number_key" ON "violations"("number");

-- CreateIndex
CREATE UNIQUE INDEX "violations_idempotency_key_key" ON "violations"("idempotency_key");

-- CreateIndex
CREATE INDEX "violations_employee_id_type_id_occurred_on_idx" ON "violations"("employee_id", "type_id", "occurred_on");

-- CreateIndex
CREATE INDEX "violations_status_idx" ON "violations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "violation_suggestions_violation_id_key" ON "violation_suggestions"("violation_id");

-- CreateIndex
CREATE INDEX "violation_suggestions_status_idx" ON "violation_suggestions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "violation_suggestions_employee_id_day_key" ON "violation_suggestions"("employee_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_corrections_number_key" ON "attendance_corrections"("number");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_corrections_idempotency_key_key" ON "attendance_corrections"("idempotency_key");

-- CreateIndex
CREATE INDEX "attendance_corrections_employee_id_day_idx" ON "attendance_corrections"("employee_id", "day");

-- CreateIndex
CREATE INDEX "attendance_corrections_status_idx" ON "attendance_corrections"("status");

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_request_days" ADD CONSTRAINT "leave_request_days_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "leave_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_request_days" ADD CONSTRAINT "leave_request_days_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_adjustments" ADD CONSTRAINT "leave_adjustments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_adjustments" ADD CONSTRAINT "leave_adjustments_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "violation_steps" ADD CONSTRAINT "violation_steps_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "violation_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "violations" ADD CONSTRAINT "violations_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "violations" ADD CONSTRAINT "violations_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "violation_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "violation_suggestions" ADD CONSTRAINT "violation_suggestions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "violation_suggestions" ADD CONSTRAINT "violation_suggestions_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "violation_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "violation_suggestions" ADD CONSTRAINT "violation_suggestions_violation_id_fkey" FOREIGN KEY ("violation_id") REFERENCES "violations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Defaults HR confirms and edits (same fixed ids as packages/db/src/hr-leave-defaults.ts, which
-- the seed runs too; only missing codes are added there).
INSERT INTO "leave_types" ("id", "code", "name_en", "name_ar", "paid", "balance", "yearly_days", "casual_allowance", "document_above_days", "max_days_per_request", "notice_days", "self_request", "sort", "updated_at") VALUES
  ('leavetype_annual', 'annual', 'Annual leave', 'إجازة اعتيادية', true, 'annual', NULL, false, NULL, NULL, 2, true, 1, now()),
  ('leavetype_casual', 'casual', 'Casual leave', 'إجازة عارضة', true, 'annual', NULL, true, NULL, 2, 0, true, 2, now()),
  ('leavetype_sick', 'sick', 'Sick leave', 'إجازة مرضية', true, 'none', NULL, false, 1, NULL, 0, true, 3, now()),
  ('leavetype_unpaid', 'unpaid', 'Unpaid leave', 'إجازة بدون أجر', false, 'none', NULL, false, NULL, NULL, 7, true, 4, now())
ON CONFLICT DO NOTHING;

INSERT INTO "violation_types" ("id", "code", "name_en", "name_ar", "category", "sort", "updated_at") VALUES
  ('vtype_late_arrival', 'late_arrival', 'Late arrival', 'التأخير عن موعد الحضور', 'attendance', 1, now()),
  ('vtype_absence', 'absence_without_leave', 'Absence without leave', 'الغياب بدون إذن', 'attendance', 2, now()),
  ('vtype_cash_shortage', 'cash_shortage', 'Cash shortage', 'عجز في النقدية', 'cash', 3, now()),
  ('vtype_damage', 'damage_negligence', 'Damage by negligence', 'إتلاف بإهمال', 'damage', 4, now()),
  ('vtype_misconduct', 'misconduct', 'Misconduct', 'سوء السلوك', 'conduct', 5, now())
ON CONFLICT DO NOTHING;

INSERT INTO "violation_steps" ("id", "type_id", "step", "penalty", "days", "amount_piastres") VALUES
  ('vstep_late_arrival_1', 'vtype_late_arrival', 1, 'written_warning', NULL, NULL),
  ('vstep_late_arrival_2', 'vtype_late_arrival', 2, 'deduction_days', 0.25, NULL),
  ('vstep_late_arrival_3', 'vtype_late_arrival', 3, 'deduction_days', 0.5, NULL),
  ('vstep_late_arrival_4', 'vtype_late_arrival', 4, 'deduction_days', 1, NULL),
  ('vstep_absence_1', 'vtype_absence', 1, 'deduction_days', 1, NULL),
  ('vstep_absence_2', 'vtype_absence', 2, 'deduction_days', 2, NULL),
  ('vstep_absence_3', 'vtype_absence', 3, 'deduction_days', 3, NULL),
  ('vstep_absence_4', 'vtype_absence', 4, 'termination_review', NULL, NULL),
  ('vstep_cash_shortage_1', 'vtype_cash_shortage', 1, 'deduction_amount', NULL, NULL),
  ('vstep_damage_1', 'vtype_damage', 1, 'deduction_amount', NULL, NULL),
  ('vstep_misconduct_1', 'vtype_misconduct', 1, 'written_warning', NULL, NULL),
  ('vstep_misconduct_2', 'vtype_misconduct', 2, 'deduction_days', 1, NULL),
  ('vstep_misconduct_3', 'vtype_misconduct', 3, 'deduction_days', 3, NULL),
  ('vstep_misconduct_4', 'vtype_misconduct', 4, 'termination_review', NULL, NULL)
ON CONFLICT DO NOTHING;
