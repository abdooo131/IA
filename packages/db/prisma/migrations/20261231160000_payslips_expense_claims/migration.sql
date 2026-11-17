-- Payslips in My HR and employee expense claims (EC-000001). Payslips need no table: they are
-- read from the posted salary run. Expense claims: an employee claims a work cost they paid
-- from their own pocket; the manager in force approves, accounting pays it from a bank or box.
-- Finance marks which expense categories may be claimed (ledger_accounts.claimable).

-- CreateEnum
CREATE TYPE "expense_claim_status" AS ENUM ('pending_manager', 'pending_accounting', 'paid', 'rejected', 'cancelled');

-- AlterTable
ALTER TABLE "ledger_accounts" ADD COLUMN     "claimable" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "expense_claims" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "employee_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "dark_store_id" TEXT,
    "expense_account_id" TEXT NOT NULL,
    "amount_piastres" INTEGER NOT NULL,
    "paid_on" DATE NOT NULL,
    "note" TEXT NOT NULL,
    "photo_id" TEXT NOT NULL,
    "status" "expense_claim_status" NOT NULL DEFAULT 'pending_manager',
    "manager_employee_id" TEXT,
    "manager_decided_by_id" TEXT,
    "manager_decided_at" TIMESTAMP(3),
    "paid_by_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "paid_from_account_id" TEXT,
    "reference" TEXT,
    "entry_id" TEXT,
    "rejected_by_id" TEXT,
    "rejected_at" TIMESTAMP(3),
    "reject_reason" TEXT,
    "rejected_step" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "expense_claims_number_key" ON "expense_claims"("number");

-- CreateIndex
CREATE UNIQUE INDEX "expense_claims_entry_id_key" ON "expense_claims"("entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_claims_idempotency_key_key" ON "expense_claims"("idempotency_key");

-- CreateIndex
CREATE INDEX "expense_claims_employee_id_status_idx" ON "expense_claims"("employee_id", "status");

-- CreateIndex
CREATE INDEX "expense_claims_status_created_at_idx" ON "expense_claims"("status", "created_at");

-- CreateIndex
CREATE INDEX "expense_claims_manager_employee_id_status_idx" ON "expense_claims"("manager_employee_id", "status");

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_expense_account_id_fkey" FOREIGN KEY ("expense_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "photos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_manager_decided_by_id_fkey" FOREIGN KEY ("manager_decided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_paid_by_id_fkey" FOREIGN KEY ("paid_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_paid_from_account_id_fkey" FOREIGN KEY ("paid_from_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_rejected_by_id_fkey" FOREIGN KEY ("rejected_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Money is never negative.
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_amount_check" CHECK ("amount_piastres" > 0);
