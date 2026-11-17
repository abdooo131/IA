-- Accounting controls: closed months, finance access levels, a second approver for large
-- amounts, receipts on money movements and opening balances.

-- What a finance user may do: look, prepare movements, or also approve and close months.
CREATE TYPE "finance_level" AS ENUM ('view', 'prepare', 'approve');
ALTER TABLE "users" ADD COLUMN "finance_level" "finance_level" NOT NULL DEFAULT 'approve';

-- One row: the books are closed through this Cairo day. Nothing may be posted before
-- locked_before (the start of the next Cairo day).
CREATE TABLE "books_lock" (
  "id" TEXT NOT NULL DEFAULT 'books',
  "closed_through" DATE NOT NULL,
  "locked_before" TIMESTAMP(3) NOT NULL,
  "updated_by_id" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "books_lock_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "books_lock_single_row" CHECK ("id" = 'books')
);
ALTER TABLE "books_lock" ADD CONSTRAINT "books_lock_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The database itself refuses lines dated inside a closed period, whatever the caller.
CREATE FUNCTION "ledger_line_period_open"() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  lock_at TIMESTAMP(3);
BEGIN
  SELECT "locked_before" INTO lock_at FROM "books_lock" WHERE "id" = 'books';
  IF lock_at IS NOT NULL AND NEW."occurred_at" < lock_at THEN
    RAISE EXCEPTION 'books_closed: % is inside a closed period', NEW."occurred_at";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ledger_lines_period_open" BEFORE INSERT ON "ledger_lines"
  FOR EACH ROW EXECUTE FUNCTION "ledger_line_period_open"();

-- Payouts above the approval limit need a second person before they are paid.
ALTER TABLE "payouts" ADD COLUMN "approved_by_id" TEXT, ADD COLUMN "approved_at" TIMESTAMP(3);
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Expenses and drawings above the limit wait here until a second person approves them.
CREATE TYPE "finance_request_status" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
CREATE TABLE "finance_requests" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "amount_piastres" INTEGER NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "finance_request_status" NOT NULL DEFAULT 'pending',
  "requested_by_id" TEXT NOT NULL,
  "decided_by_id" TEXT,
  "decided_at" TIMESTAMP(3),
  "decision_note" TEXT,
  "entry_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "finance_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "finance_requests_amount_positive" CHECK ("amount_piastres" > 0)
);
CREATE INDEX "finance_requests_status_created_at_idx" ON "finance_requests"("status", "created_at");
ALTER TABLE "finance_requests" ADD CONSTRAINT "finance_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_requests" ADD CONSTRAINT "finance_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "finance_requests" ADD CONSTRAINT "finance_requests_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "ledger_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Receipts and transfer slips: photos attached to an entry, a payout or a request. Kept as
-- their own rows so the append only ledger never changes.
ALTER TYPE "photo_kind" ADD VALUE 'receipt';
CREATE TABLE "finance_receipts" (
  "id" TEXT NOT NULL,
  "photo_id" TEXT NOT NULL,
  "entry_id" TEXT,
  "payout_id" TEXT,
  "request_id" TEXT,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "finance_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "finance_receipts_one_target" CHECK (num_nonnulls("entry_id", "payout_id", "request_id") = 1)
);
CREATE INDEX "finance_receipts_entry_id_idx" ON "finance_receipts"("entry_id");
CREATE INDEX "finance_receipts_payout_id_idx" ON "finance_receipts"("payout_id");
CREATE INDEX "finance_receipts_request_id_idx" ON "finance_receipts"("request_id");
ALTER TABLE "finance_receipts" ADD CONSTRAINT "finance_receipts_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "photos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_receipts" ADD CONSTRAINT "finance_receipts_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_receipts" ADD CONSTRAINT "finance_receipts_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_receipts" ADD CONSTRAINT "finance_receipts_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "finance_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_receipts" ADD CONSTRAINT "finance_receipts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Opening balances are posted against this equity account.
INSERT INTO "ledger_accounts" ("id", "key", "type", "code", "group_code", "category", "name_en", "name_ar", "created_at")
SELECT gen_random_uuid()::text, 'equity:opening', 'equity', '3301', 3300, 'equity', 'Opening balances', 'أرصدة افتتاحية', now()
WHERE NOT EXISTS (SELECT 1 FROM "ledger_accounts" WHERE "key" = 'equity:opening')
  AND NOT EXISTS (SELECT 1 FROM "ledger_accounts" WHERE "code" = '3301');
