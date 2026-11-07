-- HR phase 2 (docs/HR.md "Phase 2 as built"): hire drafts and their files (the new hire wizard),
-- employee exits with the settlement figures and the scheduled account disable (the leaving
-- wizard), reassignments of what a leaver looked after, and document reminders.

-- CreateEnum
CREATE TYPE "hire_draft_status" AS ENUM ('open', 'done', 'discarded');

-- CreateTable
CREATE TABLE "hire_drafts" (
    "id" TEXT NOT NULL,
    "status" "hire_draft_status" NOT NULL DEFAULT 'open',
    "step" TEXT NOT NULL DEFAULT 'person',
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" TEXT NOT NULL,
    "employee_id" TEXT,
    "idempotency_key" TEXT,
    "pay_pending" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hire_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hire_draft_files" (
    "id" TEXT NOT NULL,
    "draft_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "type_id" TEXT,
    "title" TEXT,
    "issued_on" DATE,
    "expires_on" DATE,
    "content_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hire_draft_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_exits" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "last_day" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "notice_given_on" DATE,
    "notice_days" INTEGER NOT NULL,
    "notice_short_by" INTEGER NOT NULL DEFAULT 0,
    "items_returned" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "settlement" JSONB NOT NULL,
    "disable_at" TIMESTAMP(3) NOT NULL,
    "disabled_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_exits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reassignments" (
    "id" TEXT NOT NULL,
    "exit_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "new_owner_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reassignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_reminders" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "type_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "state" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hire_drafts_employee_id_key" ON "hire_drafts"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "hire_drafts_idempotency_key_key" ON "hire_drafts"("idempotency_key");

-- CreateIndex
CREATE INDEX "hire_drafts_status_idx" ON "hire_drafts"("status");

-- CreateIndex
CREATE INDEX "hire_draft_files_draft_id_idx" ON "hire_draft_files"("draft_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_exits_idempotency_key_key" ON "employee_exits"("idempotency_key");

-- CreateIndex
CREATE INDEX "employee_exits_employee_id_idx" ON "employee_exits"("employee_id");

-- CreateIndex
CREATE INDEX "employee_exits_disabled_at_disable_at_idx" ON "employee_exits"("disabled_at", "disable_at");

-- CreateIndex
CREATE INDEX "reassignments_resolved_at_idx" ON "reassignments"("resolved_at");

-- CreateIndex
CREATE UNIQUE INDEX "reassignments_exit_id_kind_entity_id_key" ON "reassignments"("exit_id", "kind", "entity_id");

-- CreateIndex
CREATE INDEX "document_reminders_created_at_idx" ON "document_reminders"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "document_reminders_employee_id_type_id_day_key" ON "document_reminders"("employee_id", "type_id", "day");

-- AddForeignKey
ALTER TABLE "hire_drafts" ADD CONSTRAINT "hire_drafts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hire_drafts" ADD CONSTRAINT "hire_drafts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hire_draft_files" ADD CONSTRAINT "hire_draft_files_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "hire_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_exits" ADD CONSTRAINT "employee_exits_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_exits" ADD CONSTRAINT "employee_exits_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reassignments" ADD CONSTRAINT "reassignments_exit_id_fkey" FOREIGN KEY ("exit_id") REFERENCES "employee_exits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_reminders" ADD CONSTRAINT "document_reminders_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_reminders" ADD CONSTRAINT "document_reminders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

