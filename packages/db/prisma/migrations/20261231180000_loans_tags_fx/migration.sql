-- Loans (LN-), cost tags on ledger lines, bank accounts in another currency, and the daily
-- units snapshot the storage job writes (merchant profit shares rent by it).

-- CreateEnum
CREATE TYPE "loan_lender" AS ENUM ('supplier', 'owner');

-- CreateEnum
CREATE TYPE "loan_method" AS ENUM ('declining', 'flat');

-- CreateEnum
CREATE TYPE "loan_status" AS ENUM ('active', 'repaid');

-- AlterTable
ALTER TABLE "ledger_accounts" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'EGP';

-- AlterTable
ALTER TABLE "ledger_lines" ADD COLUMN     "cost_tag_id" TEXT,
ADD COLUMN     "foreign_cents" INTEGER,
ADD COLUMN     "fx_rate_micro" BIGINT;

-- AlterTable
ALTER TABLE "petty_cash_expenses" ADD COLUMN     "cost_tag_id" TEXT;

-- CreateTable
CREATE TABLE "cost_tags" (
    "id" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loans" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "lender" "loan_lender" NOT NULL,
    "supplier_id" TEXT,
    "lender_name" TEXT,
    "principal_piastres" INTEGER NOT NULL,
    "money_account_id" TEXT NOT NULL,
    "liability_account_id" TEXT NOT NULL,
    "start_day" DATE NOT NULL,
    "annual_rate_bp" INTEGER NOT NULL,
    "method" "loan_method" NOT NULL,
    "months" INTEGER NOT NULL,
    "first_payment_day" DATE NOT NULL,
    "reference" TEXT NOT NULL,
    "memo" TEXT,
    "status" "loan_status" NOT NULL DEFAULT 'active',
    "entry_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_instalments" (
    "id" TEXT NOT NULL,
    "loan_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "due_day" DATE NOT NULL,
    "instalment_piastres" INTEGER NOT NULL,
    "interest_piastres" INTEGER NOT NULL,
    "principal_piastres" INTEGER NOT NULL,
    "remaining_piastres" INTEGER NOT NULL,
    "paid_at" TIMESTAMP(3),
    "entry_id" TEXT,

    CONSTRAINT "loan_instalments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_unit_days" (
    "dark_store_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "units" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_unit_days_pkey" PRIMARY KEY ("dark_store_id","merchant_id","day")
);

-- CreateTable
CREATE TABLE "storage_days" (
    "day" DATE NOT NULL,
    "charged" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "storage_days_pkey" PRIMARY KEY ("day")
);

-- CreateIndex
CREATE UNIQUE INDEX "cost_tags_name_en_key" ON "cost_tags"("name_en");

-- CreateIndex
CREATE UNIQUE INDEX "loans_number_key" ON "loans"("number");

-- CreateIndex
CREATE UNIQUE INDEX "loans_liability_account_id_key" ON "loans"("liability_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "loans_entry_id_key" ON "loans"("entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "loan_instalments_entry_id_key" ON "loan_instalments"("entry_id");

-- CreateIndex
CREATE INDEX "loan_instalments_due_day_idx" ON "loan_instalments"("due_day");

-- CreateIndex
CREATE UNIQUE INDEX "loan_instalments_loan_id_seq_key" ON "loan_instalments"("loan_id", "seq");

-- CreateIndex
CREATE INDEX "stock_unit_days_day_idx" ON "stock_unit_days"("day");

-- CreateIndex
CREATE INDEX "ledger_lines_cost_tag_id_occurred_at_idx" ON "ledger_lines"("cost_tag_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_cost_tag_id_fkey" FOREIGN KEY ("cost_tag_id") REFERENCES "cost_tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petty_cash_expenses" ADD CONSTRAINT "petty_cash_expenses_cost_tag_id_fkey" FOREIGN KEY ("cost_tag_id") REFERENCES "cost_tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_money_account_id_fkey" FOREIGN KEY ("money_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_liability_account_id_fkey" FOREIGN KEY ("liability_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_instalments" ADD CONSTRAINT "loan_instalments_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_instalments" ADD CONSTRAINT "loan_instalments_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Money and schedules are never negative; a currency is three capitals.
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "loans" ADD CONSTRAINT "loans_amounts_check"
  CHECK ("principal_piastres" > 0 AND "annual_rate_bp" >= 0 AND "months" BETWEEN 1 AND 600);
ALTER TABLE "loan_instalments" ADD CONSTRAINT "loan_instalments_amounts_check"
  CHECK ("instalment_piastres" >= 0 AND "interest_piastres" >= 0 AND "principal_piastres" >= 0
         AND "remaining_piastres" >= 0
         AND "instalment_piastres" = "interest_piastres" + "principal_piastres");
ALTER TABLE "stock_unit_days" ADD CONSTRAINT "stock_unit_days_units_check" CHECK ("units" >= 0);
