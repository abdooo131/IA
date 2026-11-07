-- CreateEnum
CREATE TYPE "company" AS ENUM ('shiply_now', 'shiply');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ledger_account_type" ADD VALUE 'hub_safe';
ALTER TYPE "ledger_account_type" ADD VALUE 'courier_cash';
ALTER TYPE "ledger_account_type" ADD VALUE 'courier_wallet';
ALTER TYPE "ledger_account_type" ADD VALUE 'agent_payable';



-- AlterTable
ALTER TABLE "ledger_accounts" ADD COLUMN     "agent_id" TEXT,
ADD COLUMN     "hub_id" TEXT;

-- AlterTable
ALTER TABLE "ledger_lines" ADD COLUMN     "company" "company" NOT NULL DEFAULT 'shiply_now',
ADD COLUMN     "cost_center_id" TEXT,
ADD COLUMN     "hub_id" TEXT;

-- CreateTable
CREATE TABLE "cost_centers" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "company" "company" NOT NULL,
    "dark_store_id" TEXT,
    "hub_id" TEXT,
    "department_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cost_centers_code_key" ON "cost_centers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centers_dark_store_id_key" ON "cost_centers"("dark_store_id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centers_hub_id_key" ON "cost_centers"("hub_id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centers_department_id_key" ON "cost_centers"("department_id");

-- CreateIndex
CREATE INDEX "ledger_lines_company_occurred_at_idx" ON "ledger_lines"("company", "occurred_at");

-- CreateIndex
CREATE INDEX "ledger_lines_cost_center_id_occurred_at_idx" ON "ledger_lines"("cost_center_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

