-- Basata cash deposits (owner, 2026-11-11). Riders deposit the cash they collected at a Basata
-- branch and send the receipt photo (BD-000001); Accounting approves (Dr Money at Basata,
-- Cr 1300 rider cash) or rejects it; Basata's daily transfer to the bank, less its fee, settles
-- approved deposits (BT-000001). Cash still held at the deposit deadline is taken from the
-- rider (their office's wallet or their own dues) and the rider is frozen until Accounting
-- unfreezes them.

-- CreateEnum
CREATE TYPE "basata_deposit_status" AS ENUM ('pending', 'approved', 'rejected');

-- AlterEnum
ALTER TYPE "photo_kind" ADD VALUE 'basata_receipt';

-- AlterTable
ALTER TABLE "riders" ADD COLUMN     "frozen_at" TIMESTAMP(3),
ADD COLUMN     "frozen_by_id" TEXT,
ADD COLUMN     "frozen_reason" TEXT;

-- CreateTable
CREATE TABLE "basata_deposits" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "rider_id" TEXT NOT NULL,
    "dark_store_id" TEXT NOT NULL,
    "amount_piastres" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "deposited_at" TIMESTAMP(3) NOT NULL,
    "photo_id" TEXT NOT NULL,
    "status" "basata_deposit_status" NOT NULL DEFAULT 'pending',
    "deadline_day" DATE NOT NULL,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "reject_reason" TEXT,
    "entry_id" TEXT,
    "held_piastres" INTEGER,
    "given_back_piastres" INTEGER NOT NULL DEFAULT 0,
    "settlement_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "basata_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "basata_settlements" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "received_on" DATE NOT NULL,
    "amount_piastres" INTEGER NOT NULL,
    "deposits_piastres" INTEGER NOT NULL,
    "fee_piastres" INTEGER NOT NULL,
    "reference" TEXT,
    "entry_id" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "basata_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rider_cash_deductions" (
    "id" TEXT NOT NULL,
    "rider_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "deposit_id" TEXT,
    "held_piastres" INTEGER NOT NULL,
    "amount_piastres" INTEGER NOT NULL,
    "supplier_id" TEXT,
    "entry_id" TEXT,
    "given_back_piastres" INTEGER NOT NULL DEFAULT 0,
    "key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rider_cash_deductions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rider_freezes" (
    "id" TEXT NOT NULL,
    "rider_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "day" DATE,
    "amount_piastres" INTEGER NOT NULL DEFAULT 0,
    "frozen_at" TIMESTAMP(3) NOT NULL,
    "frozen_by_id" TEXT,
    "unfrozen_at" TIMESTAMP(3),
    "unfrozen_by_id" TEXT,
    "unfreeze_reason" TEXT,

    CONSTRAINT "rider_freezes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_deadline_runs" (
    "day" DATE NOT NULL,
    "deadline_at" TIMESTAMP(3) NOT NULL,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "frozen" INTEGER NOT NULL DEFAULT 0,
    "charged_piastres" INTEGER NOT NULL DEFAULT 0,
    "ran_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_deadline_runs_pkey" PRIMARY KEY ("day")
);

-- CreateIndex
CREATE UNIQUE INDEX "basata_deposits_number_key" ON "basata_deposits"("number");

-- CreateIndex
CREATE UNIQUE INDEX "basata_deposits_reference_key" ON "basata_deposits"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "basata_deposits_entry_id_key" ON "basata_deposits"("entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "basata_deposits_idempotency_key_key" ON "basata_deposits"("idempotency_key");

-- CreateIndex
CREATE INDEX "basata_deposits_rider_id_status_idx" ON "basata_deposits"("rider_id", "status");

-- CreateIndex
CREATE INDEX "basata_deposits_status_created_at_idx" ON "basata_deposits"("status", "created_at");

-- CreateIndex
CREATE INDEX "basata_deposits_settlement_id_idx" ON "basata_deposits"("settlement_id");

-- CreateIndex
CREATE UNIQUE INDEX "basata_settlements_number_key" ON "basata_settlements"("number");

-- CreateIndex
CREATE UNIQUE INDEX "basata_settlements_entry_id_key" ON "basata_settlements"("entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "basata_settlements_idempotency_key_key" ON "basata_settlements"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "rider_cash_deductions_entry_id_key" ON "rider_cash_deductions"("entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "rider_cash_deductions_key_key" ON "rider_cash_deductions"("key");

-- CreateIndex
CREATE INDEX "rider_cash_deductions_rider_id_created_at_idx" ON "rider_cash_deductions"("rider_id", "created_at");

-- CreateIndex
CREATE INDEX "rider_freezes_rider_id_frozen_at_idx" ON "rider_freezes"("rider_id", "frozen_at");

-- AddForeignKey
ALTER TABLE "basata_deposits" ADD CONSTRAINT "basata_deposits_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "basata_deposits" ADD CONSTRAINT "basata_deposits_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "basata_deposits" ADD CONSTRAINT "basata_deposits_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "photos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "basata_deposits" ADD CONSTRAINT "basata_deposits_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "basata_deposits" ADD CONSTRAINT "basata_deposits_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "basata_deposits" ADD CONSTRAINT "basata_deposits_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "basata_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "basata_settlements" ADD CONSTRAINT "basata_settlements_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "basata_settlements" ADD CONSTRAINT "basata_settlements_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "basata_settlements" ADD CONSTRAINT "basata_settlements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_cash_deductions" ADD CONSTRAINT "rider_cash_deductions_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_cash_deductions" ADD CONSTRAINT "rider_cash_deductions_deposit_id_fkey" FOREIGN KEY ("deposit_id") REFERENCES "basata_deposits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_cash_deductions" ADD CONSTRAINT "rider_cash_deductions_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_cash_deductions" ADD CONSTRAINT "rider_cash_deductions_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_freezes" ADD CONSTRAINT "rider_freezes_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_freezes" ADD CONSTRAINT "rider_freezes_frozen_by_id_fkey" FOREIGN KEY ("frozen_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rider_freezes" ADD CONSTRAINT "rider_freezes_unfrozen_by_id_fkey" FOREIGN KEY ("unfrozen_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Money is never negative; a deposit and a transfer always carry money.
ALTER TABLE "basata_deposits" ADD CONSTRAINT "basata_deposits_amount_check"
  CHECK ("amount_piastres" > 0 AND "given_back_piastres" >= 0 AND ("held_piastres" IS NULL OR "held_piastres" >= 0));
ALTER TABLE "basata_settlements" ADD CONSTRAINT "basata_settlements_amount_check"
  CHECK ("amount_piastres" > 0 AND "fee_piastres" >= 0 AND "deposits_piastres" = "amount_piastres" + "fee_piastres");
ALTER TABLE "rider_cash_deductions" ADD CONSTRAINT "rider_cash_deductions_amount_check"
  CHECK ("amount_piastres" >= 0 AND "held_piastres" >= 0 AND "given_back_piastres" >= 0 AND "given_back_piastres" <= "amount_piastres");

