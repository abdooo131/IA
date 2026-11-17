-- CreateEnum
CREATE TYPE "payout_schedule" AS ENUM ('daily', 'twice_weekly', 'weekly');

-- CreateEnum
CREATE TYPE "ledger_account_type" AS ENUM ('merchant', 'rider_cash', 'rider_bonus', 'store_cash', 'bank', 'revenue', 'vat_payable', 'rider_bonus_expense', 'cash_difference');

-- CreateEnum
CREATE TYPE "cash_handover_status" AS ENUM ('balanced', 'pending', 'written_off', 'charged_to_rider');

-- CreateEnum
CREATE TYPE "payout_status" AS ENUM ('draft', 'paid', 'cancelled');

-- AlterEnum
ALTER TYPE "role" ADD VALUE 'finance';

-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "payout_schedule" "payout_schedule" NOT NULL DEFAULT 'weekly';

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" "ledger_account_type" NOT NULL,
    "merchant_id" TEXT,
    "rider_id" TEXT,
    "dark_store_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "memo" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "order_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "data" JSONB,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_lines" (
    "id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "amount_piastres" INTEGER NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_handovers" (
    "id" TEXT NOT NULL,
    "rider_id" TEXT NOT NULL,
    "dark_store_id" TEXT NOT NULL,
    "expected_piastres" INTEGER NOT NULL,
    "counted_piastres" INTEGER NOT NULL,
    "difference_piastres" INTEGER NOT NULL,
    "status" "cash_handover_status" NOT NULL,
    "note" TEXT,
    "received_by_id" TEXT NOT NULL,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "cutoff_at" TIMESTAMP(3) NOT NULL,
    "amount_piastres" INTEGER NOT NULL,
    "status" "payout_status" NOT NULL DEFAULT 'draft',
    "reference" TEXT,
    "note" TEXT,
    "created_by_id" TEXT NOT NULL,
    "paid_by_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_key_key" ON "ledger_accounts"("key");

-- CreateIndex
CREATE INDEX "ledger_accounts_type_idx" ON "ledger_accounts"("type");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_idempotency_key_key" ON "ledger_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "ledger_entries_kind_occurred_at_idx" ON "ledger_entries"("kind", "occurred_at");

-- CreateIndex
CREATE INDEX "ledger_entries_order_id_idx" ON "ledger_entries"("order_id");

-- CreateIndex
CREATE INDEX "ledger_lines_account_id_occurred_at_idx" ON "ledger_lines"("account_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "cash_handovers_idempotency_key_key" ON "cash_handovers"("idempotency_key");

-- CreateIndex
CREATE INDEX "cash_handovers_status_created_at_idx" ON "cash_handovers"("status", "created_at");

-- CreateIndex
CREATE INDEX "cash_handovers_rider_id_created_at_idx" ON "cash_handovers"("rider_id", "created_at");

-- CreateIndex
CREATE INDEX "payouts_merchant_id_status_idx" ON "payouts"("merchant_id", "status");

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_paid_by_id_fkey" FOREIGN KEY ("paid_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Ledger rows are history: never changed or removed (corrections are new entries).
CREATE TRIGGER "ledger_entries_append_only" BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_change"();
CREATE TRIGGER "ledger_lines_append_only" BEFORE UPDATE OR DELETE ON "ledger_lines"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_change"();

-- Double entry: the lines of every entry add up to zero. Checked at commit, so all lines
-- of one entry can be inserted first.
CREATE FUNCTION "ledger_entry_must_balance"() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  total BIGINT;
  lines INT;
BEGIN
  SELECT COALESCE(SUM("amount_piastres"), 0), COUNT(*) INTO total, lines
    FROM "ledger_lines" WHERE "entry_id" = NEW."entry_id";
  IF total <> 0 OR lines < 2 THEN
    RAISE EXCEPTION 'ledger entry % does not balance (total %, % lines)', NEW."entry_id", total, lines;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "ledger_lines_balance" AFTER INSERT ON "ledger_lines"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "ledger_entry_must_balance"();

ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_amount_not_zero" CHECK ("amount_piastres" <> 0);
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_amounts" CHECK (
  "expected_piastres" >= 0 AND "counted_piastres" >= 0
  AND "difference_piastres" = "expected_piastres" - "counted_piastres");
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_amount_positive" CHECK ("amount_piastres" > 0);
