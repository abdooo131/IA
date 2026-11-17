-- Rider pay (CLAUDE.md "Rider pay"): riders are paid per delivered order through a wallet.
-- Employees get a pay basis (riders per delivery, off the salary run), riders owe the company
-- through a rider_dues wallet (1350), and riders ask for withdrawals (RW-000001) that
-- Accounting approves and pays.

-- CreateEnum
CREATE TYPE "rider_withdrawal_status" AS ENUM ('requested', 'approved', 'paid', 'rejected', 'cancelled');

-- CreateEnum
CREATE TYPE "rider_withdrawal_method" AS ENUM ('store_cash', 'instapay', 'mobile_wallet', 'bank');

-- CreateEnum
CREATE TYPE "pay_basis" AS ENUM ('monthly_salary', 'per_delivery');

-- AlterEnum
ALTER TYPE "ledger_account_type" ADD VALUE 'rider_dues';

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "pay_basis" "pay_basis" NOT NULL DEFAULT 'monthly_salary';

-- CreateTable
CREATE TABLE "rider_withdrawals" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "rider_id" TEXT NOT NULL,
    "dark_store_id" TEXT NOT NULL,
    "amount_piastres" INTEGER NOT NULL,
    "deduction_piastres" INTEGER NOT NULL DEFAULT 0,
    "deductions" JSONB NOT NULL,
    "method" "rider_withdrawal_method" NOT NULL,
    "details" JSONB NOT NULL,
    "status" "rider_withdrawal_status" NOT NULL DEFAULT 'requested',
    "idempotency_key" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "paid_by_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "paid_from_account_id" TEXT,
    "reference" TEXT,
    "entry_id" TEXT,
    "rejected_by_id" TEXT,
    "rejected_at" TIMESTAMP(3),
    "reject_reason" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rider_withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rider_withdrawals_number_key" ON "rider_withdrawals"("number");

-- CreateIndex
CREATE UNIQUE INDEX "rider_withdrawals_idempotency_key_key" ON "rider_withdrawals"("idempotency_key");

-- CreateIndex
CREATE INDEX "rider_withdrawals_rider_id_status_idx" ON "rider_withdrawals"("rider_id", "status");

-- CreateIndex
CREATE INDEX "rider_withdrawals_status_created_at_idx" ON "rider_withdrawals"("status", "created_at");

-- AddForeignKey
ALTER TABLE "rider_withdrawals" ADD CONSTRAINT "rider_withdrawals_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_withdrawals" ADD CONSTRAINT "rider_withdrawals_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_withdrawals" ADD CONSTRAINT "rider_withdrawals_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_withdrawals" ADD CONSTRAINT "rider_withdrawals_paid_by_id_fkey" FOREIGN KEY ("paid_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_withdrawals" ADD CONSTRAINT "rider_withdrawals_rejected_by_id_fkey" FOREIGN KEY ("rejected_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_withdrawals" ADD CONSTRAINT "rider_withdrawals_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Money is never negative.
ALTER TABLE "rider_withdrawals" ADD CONSTRAINT "rider_withdrawals_amount_check" CHECK ("amount_piastres" > 0);
ALTER TABLE "rider_withdrawals" ADD CONSTRAINT "rider_withdrawals_deduction_check" CHECK ("deduction_piastres" >= 0);

-- Every rider's file is paid per delivered order from now on (no monthly salary).
UPDATE "employees" SET "pay_basis" = 'per_delivery'
WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "role" = 'rider');
