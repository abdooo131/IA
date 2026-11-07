-- Cheques register and merchant contracts (volume tiers, monthly minimum, security deposit,
-- credit limit). Ledger accounts are opened on first use: 1151 cheques under collection,
-- 2451 cheques payable and one 2600-xxxx security deposit wallet per merchant.

-- CreateEnum
CREATE TYPE "cheque_direction" AS ENUM ('received', 'issued');

-- CreateEnum
CREATE TYPE "cheque_purpose" AS ENUM ('merchant', 'deposit', 'supplier', 'other_income', 'bill', 'payout', 'deposit_refund');

-- CreateEnum
CREATE TYPE "cheque_status" AS ENUM ('awaiting_approval', 'received', 'issued', 'deposited', 'cleared', 'bounced', 'cancelled');

-- AlterEnum
ALTER TYPE "ledger_account_type" ADD VALUE 'merchant_deposit';

-- CreateTable
CREATE TABLE "cheques" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "direction" "cheque_direction" NOT NULL,
    "purpose" "cheque_purpose" NOT NULL,
    "status" "cheque_status" NOT NULL,
    "cheque_number" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "party_name" TEXT NOT NULL,
    "amount_piastres" INTEGER NOT NULL,
    "issue_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "merchant_id" TEXT,
    "supplier_id" TEXT,
    "bill_id" TEXT,
    "payout_id" TEXT,
    "income_account_id" TEXT,
    "bank_account_id" TEXT,
    "photo_id" TEXT,
    "note" TEXT,
    "book_entry_id" TEXT,
    "clear_entry_id" TEXT,
    "reverse_entry_id" TEXT,
    "deposited_at" TIMESTAMP(3),
    "cleared_at" TIMESTAMP(3),
    "bounced_at" TIMESTAMP(3),
    "bounce_reason" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancel_note" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cheques_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_contracts" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "notice_days" INTEGER NOT NULL,
    "minimum_monthly_fee_piastres" INTEGER,
    "security_deposit_piastres" INTEGER,
    "credit_limit_piastres" INTEGER,
    "note" TEXT,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_contract_tiers" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "from_order" INTEGER NOT NULL,
    "fixed_fee_piastres" INTEGER,
    "percent_bp" INTEGER,

    CONSTRAINT "merchant_contract_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cheques_number_key" ON "cheques"("number");

-- CreateIndex
CREATE UNIQUE INDEX "cheques_idempotency_key_key" ON "cheques"("idempotency_key");

-- CreateIndex
CREATE INDEX "cheques_status_due_date_idx" ON "cheques"("status", "due_date");

-- CreateIndex
CREATE INDEX "cheques_merchant_id_idx" ON "cheques"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_contracts_merchant_id_key" ON "merchant_contracts"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_contract_tiers_contract_id_from_order_key" ON "merchant_contract_tiers"("contract_id", "from_order");

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_income_account_id_fkey" FOREIGN KEY ("income_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "photos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_book_entry_id_fkey" FOREIGN KEY ("book_entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_clear_entry_id_fkey" FOREIGN KEY ("clear_entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_reverse_entry_id_fkey" FOREIGN KEY ("reverse_entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_contracts" ADD CONSTRAINT "merchant_contracts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_contracts" ADD CONSTRAINT "merchant_contracts_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_contract_tiers" ADD CONSTRAINT "merchant_contract_tiers_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "merchant_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Money is never negative, cheques carry a real amount and tiers start at the first order.
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_amount_positive" CHECK ("amount_piastres" > 0);
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_due_after_issue" CHECK ("due_date" >= "issue_date");
ALTER TABLE "merchant_contracts" ADD CONSTRAINT "merchant_contracts_money_non_negative" CHECK (
  COALESCE("minimum_monthly_fee_piastres", 0) >= 0
  AND COALESCE("security_deposit_piastres", 0) >= 0
  AND COALESCE("credit_limit_piastres", 0) >= 0
  AND "notice_days" >= 0
);
ALTER TABLE "merchant_contracts" ADD CONSTRAINT "merchant_contracts_dates" CHECK ("end_date" IS NULL OR "end_date" >= "start_date");
ALTER TABLE "merchant_contract_tiers" ADD CONSTRAINT "merchant_contract_tiers_values" CHECK (
  "from_order" >= 1
  AND COALESCE("fixed_fee_piastres", 0) >= 0
  AND COALESCE("percent_bp", 0) BETWEEN 0 AND 10000
);

-- The same cheque (direction, bank and printed number) is registered once while it is alive.
CREATE UNIQUE INDEX "cheques_live_number_key" ON "cheques" ("direction", lower("bank_name"), "cheque_number")
  WHERE "status" NOT IN ('cancelled', 'bounced');
