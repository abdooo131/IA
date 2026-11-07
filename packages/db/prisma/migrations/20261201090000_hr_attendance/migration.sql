-- HR step 2 (docs/HR.md 2): shift templates, the roster, official holidays, punches (Clock in
-- and Clock out with the phone's position) and one attendance day per person and Cairo day.
-- Store managers get HR view (their stores' attendance board and roster).

-- CreateEnum
CREATE TYPE "punch_kind" AS ENUM ('in', 'out');

-- CreateEnum
CREATE TYPE "punch_source" AS ENUM ('app', 'manual', 'auto');

-- CreateEnum
CREATE TYPE "attendance_status" AS ENUM ('present', 'late', 'left_early', 'absent', 'on_leave', 'day_off', 'holiday');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "default_shift_id" TEXT;

-- CreateTable
CREATE TABLE "shifts" (
    "id" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "break_minutes" INTEGER NOT NULL DEFAULT 0,
    "weekdays" INTEGER[],
    "overnight" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roster_days" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "dark_store_id" TEXT,
    "shift_id" TEXT,
    "start_minute" INTEGER,
    "end_minute" INTEGER,
    "break_minutes" INTEGER,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roster_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "punches" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "kind" "punch_kind" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracy_m" INTEGER,
    "distance_m" INTEGER,
    "dark_store_id" TEXT,
    "device" TEXT,
    "source" "punch_source" NOT NULL,
    "reason" TEXT,
    "by_user_id" TEXT,
    "voided_at" TIMESTAMP(3),
    "voided_by_id" TEXT,
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "punches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_days" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "dark_store_id" TEXT,
    "shift_id" TEXT,
    "planned_start" TIMESTAMP(3),
    "planned_end" TIMESTAMP(3),
    "status" "attendance_status" NOT NULL,
    "computed_status" "attendance_status" NOT NULL,
    "override_status" "attendance_status",
    "first_in" TIMESTAMP(3),
    "last_out" TIMESTAMP(3),
    "late_minutes" INTEGER NOT NULL DEFAULT 0,
    "early_minutes" INTEGER NOT NULL DEFAULT 0,
    "overtime_minutes" INTEGER NOT NULL DEFAULT 0,
    "worked_minutes" INTEGER NOT NULL DEFAULT 0,
    "flags" TEXT[],
    "corrected_by_id" TEXT,
    "correction_reason" TEXT,
    "corrected_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "roster_days_dark_store_id_day_idx" ON "roster_days"("dark_store_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "roster_days_employee_id_day_key" ON "roster_days"("employee_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_day_key" ON "holidays"("day");

-- CreateIndex
CREATE INDEX "punches_employee_id_at_idx" ON "punches"("employee_id", "at");

-- CreateIndex
CREATE INDEX "attendance_days_dark_store_id_day_idx" ON "attendance_days"("dark_store_id", "day");

-- CreateIndex
CREATE INDEX "attendance_days_day_idx" ON "attendance_days"("day");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_days_employee_id_day_key" ON "attendance_days"("employee_id", "day");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_default_shift_id_fkey" FOREIGN KEY ("default_shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_days" ADD CONSTRAINT "roster_days_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_days" ADD CONSTRAINT "roster_days_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_days" ADD CONSTRAINT "roster_days_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "punches" ADD CONSTRAINT "punches_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "punches" ADD CONSTRAINT "punches_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Business rules the database keeps as well.
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_minutes_check" CHECK (
  "start_minute" BETWEEN 0 AND 1439 AND "end_minute" BETWEEN 0 AND 1439
  AND "break_minutes" BETWEEN 0 AND 240 AND ("overnight" OR "end_minute" > "start_minute"));
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_minutes_check" CHECK (
  "late_minutes" >= 0 AND "early_minutes" >= 0 AND "overtime_minutes" >= 0
  AND "worked_minutes" >= 0);

-- Punches are evidence: never deleted (a wrong one is voided with a reason).
CREATE TRIGGER "punches_no_delete" BEFORE DELETE ON "punches"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_change"();

-- Store managers see their stores' attendance (docs/ACCESS.md).
UPDATE "user_access" SET "hr" = 'view' WHERE "job_role" = 'store_manager' AND "hr" = 'none';
