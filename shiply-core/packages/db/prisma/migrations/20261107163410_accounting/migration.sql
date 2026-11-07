-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('MERCHANT', 'COURIER', 'AGENT', 'HUB');

-- CreateEnum
CREATE TYPE "EarningKind" AS ENUM ('DELIVERY', 'RETURN', 'PICKUP', 'BONUS', 'PENALTY', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'PAID', 'REJECTED');

-- CreateEnum
CREATE TYPE "PayInChannel" AS ENUM ('FAWRY', 'BASATA', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "PayInPurpose" AS ENUM ('CASH', 'RECHARGE');

-- CreateEnum
CREATE TYPE "CheckStatus" AS ENUM ('SUBMITTED', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PaidFrom" AS ENUM ('BANK', 'HUB_SAFE');

-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "bank_account_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bank_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "iban" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "payout_days" INTEGER[] DEFAULT ARRAY[0, 3]::INTEGER[],
ADD COLUMN     "pending_bank" JSONB,
ADD COLUMN     "pending_bank_by_id" UUID;

-- AlterTable
ALTER TABLE "payouts" ADD COLUMN     "account_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by_id" UUID,
ADD COLUMN     "bank_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "iban" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "paid_at" TIMESTAMP(3),
ADD COLUMN     "paid_by_id" UUID,
ADD COLUMN     "payout_fee" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING_APPROVAL';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "unfreeze_reason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "unfreeze_until" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "accounts" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "party" "PartyType",
    "system" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "date" TEXT NOT NULL,
    "memo" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "key" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "account_code" TEXT NOT NULL,
    "party_type" "PartyType",
    "party_id" UUID,
    "debit" INTEGER NOT NULL DEFAULT 0,
    "credit" INTEGER NOT NULL DEFAULT 0,
    "memo" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_earnings" (
    "id" UUID NOT NULL,
    "courier_id" UUID NOT NULL,
    "agent_id" UUID,
    "kind" "EarningKind" NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "amount" INTEGER NOT NULL,
    "shipment_id" UUID,
    "date" TEXT NOT NULL,
    "available_at" TIMESTAMP(3) NOT NULL,
    "settlement_id" UUID,
    "note" TEXT NOT NULL DEFAULT '',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courier_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "courier_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT '',
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "note" TEXT NOT NULL DEFAULT '',
    "requested_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_ins" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "courier_id" UUID NOT NULL,
    "run_id" UUID,
    "amount" INTEGER NOT NULL,
    "channel" "PayInChannel" NOT NULL DEFAULT 'FAWRY',
    "purpose" "PayInPurpose" NOT NULL DEFAULT 'CASH',
    "reference" TEXT NOT NULL,
    "receipt" BYTEA,
    "receipt_mime" TEXT NOT NULL DEFAULT '',
    "status" "CheckStatus" NOT NULL DEFAULT 'SUBMITTED',
    "note" TEXT NOT NULL DEFAULT '',
    "checked_by_id" UUID,
    "checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pay_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safe_deposits" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "hub_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "receipt" BYTEA,
    "receipt_mime" TEXT NOT NULL DEFAULT '',
    "status" "CheckStatus" NOT NULL DEFAULT 'SUBMITTED',
    "note" TEXT NOT NULL DEFAULT '',
    "created_by_id" UUID NOT NULL,
    "checked_by_id" UUID,
    "checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "safe_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_settlements" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "agent_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "staff_pay" INTEGER NOT NULL,
    "commission_bp" INTEGER NOT NULL,
    "commission" INTEGER NOT NULL,
    "vehicle_rent" INTEGER NOT NULL,
    "special_vehicles" INTEGER NOT NULL,
    "penalties" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "details" JSONB NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "invoice" BYTEA,
    "invoice_name" TEXT NOT NULL DEFAULT '',
    "invoice_mime" TEXT NOT NULL DEFAULT '',
    "created_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "paid_from" "PaidFrom" NOT NULL DEFAULT 'BANK',
    "hub_id" UUID,
    "supplier" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "receipt" BYTEA,
    "receipt_mime" TEXT NOT NULL DEFAULT '',
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "created_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_drafts" (
    "id" UUID NOT NULL,
    "date" TEXT NOT NULL,
    "memo" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "entry_id" UUID,
    "created_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_number_key" ON "journal_entries"("number");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_key_key" ON "journal_entries"("key");

-- CreateIndex
CREATE INDEX "journal_entries_date_idx" ON "journal_entries"("date");

-- CreateIndex
CREATE INDEX "journal_entries_source_idx" ON "journal_entries"("source");

-- CreateIndex
CREATE INDEX "journal_lines_account_code_party_type_party_id_idx" ON "journal_lines"("account_code", "party_type", "party_id");

-- CreateIndex
CREATE INDEX "journal_lines_entry_id_idx" ON "journal_lines"("entry_id");

-- CreateIndex
CREATE INDEX "courier_earnings_courier_id_date_idx" ON "courier_earnings"("courier_id", "date");

-- CreateIndex
CREATE INDEX "courier_earnings_agent_id_date_idx" ON "courier_earnings"("agent_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "courier_earnings_courier_id_kind_shipment_id_key" ON "courier_earnings"("courier_id", "kind", "shipment_id");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_code_key" ON "withdrawals"("code");

-- CreateIndex
CREATE INDEX "withdrawals_courier_id_idx" ON "withdrawals"("courier_id");

-- CreateIndex
CREATE UNIQUE INDEX "pay_ins_code_key" ON "pay_ins"("code");

-- CreateIndex
CREATE INDEX "pay_ins_status_idx" ON "pay_ins"("status");

-- CreateIndex
CREATE INDEX "pay_ins_run_id_idx" ON "pay_ins"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "safe_deposits_code_key" ON "safe_deposits"("code");

-- CreateIndex
CREATE INDEX "safe_deposits_hub_id_status_idx" ON "safe_deposits"("hub_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_settlements_code_key" ON "agent_settlements"("code");

-- CreateIndex
CREATE UNIQUE INDEX "agent_settlements_agent_id_month_key" ON "agent_settlements"("agent_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_code_key" ON "expenses"("code");

-- CreateIndex
CREATE INDEX "payouts_status_idx" ON "payouts"("status");

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_code_fkey" FOREIGN KEY ("account_code") REFERENCES "accounts"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Payouts made before approvals existed were already paid.
UPDATE "payouts" SET "status" = 'PAID', "paid_at" = "created_at", "approved_at" = "created_at" WHERE "status" = 'PENDING_APPROVAL';

-- Codes for the new money records.
CREATE SEQUENCE IF NOT EXISTS money_seq START 1;

-- The books are append only: corrections are new entries.
CREATE TRIGGER journal_entries_append_only BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER journal_lines_append_only BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION reject_change();

-- A line is a debit or a credit, never negative, never both.
ALTER TABLE journal_lines ADD CONSTRAINT journal_lines_one_side
  CHECK (debit >= 0 AND credit >= 0 AND (debit = 0) <> (credit = 0));

-- Every entry balances. Checked at commit, after all its lines are in.
CREATE FUNCTION check_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE diff bigint;
BEGIN
  SELECT COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0) INTO diff FROM journal_lines WHERE entry_id = NEW.entry_id;
  IF diff <> 0 THEN
    RAISE EXCEPTION 'journal entry % does not balance (difference %)', NEW.entry_id, diff;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER journal_lines_balanced AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_entry_balanced();
