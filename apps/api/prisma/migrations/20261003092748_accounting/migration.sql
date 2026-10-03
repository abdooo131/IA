-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "JournalType" AS ENUM ('COD_COLLECTED', 'ORDER_SETTLEMENT', 'FAILED_DELIVERY_FEE', 'CASH_DEPOSIT', 'MERCHANT_CASHOUT', 'MERCHANT_ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "CashoutMethod" AS ENUM ('BANK', 'FAWRY_ACCOUNT', 'FAWRY_CARD');

-- CreateEnum
CREATE TYPE "CashoutStatus" AS ENUM ('PENDING', 'PAID', 'REJECTED');

-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "last_auto_cashout_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "finalized_at" TIMESTAMP(3),
ADD COLUMN     "settled_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "description" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" BIGSERIAL NOT NULL,
    "type" "JournalType" NOT NULL,
    "description" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "merchant_id" UUID,
    "order_id" UUID,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "reverses_id" BIGINT,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" BIGSERIAL NOT NULL,
    "journal_id" BIGINT NOT NULL,
    "account_code" TEXT NOT NULL,
    "merchant_id" UUID,
    "order_id" UUID,
    "debit" INTEGER NOT NULL DEFAULT 0,
    "credit" INTEGER NOT NULL DEFAULT 0,
    "memo" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cashout_requests" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "fee" INTEGER NOT NULL,
    "net_amount" INTEGER NOT NULL,
    "method" "CashoutMethod" NOT NULL,
    "destination" TEXT NOT NULL,
    "status" "CashoutStatus" NOT NULL DEFAULT 'PENDING',
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "requested_by_id" UUID,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "payout_reference" TEXT,
    "reject_reason" TEXT,
    "journal_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cashout_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_deposits" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "deposited_at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "journal_id" BIGINT NOT NULL,
    "recorded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_runs" (
    "id" UUID NOT NULL,
    "as_of" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "orders_settled" INTEGER NOT NULL DEFAULT 0,
    "orders_charged" INTEGER NOT NULL DEFAULT 0,
    "cashouts_created" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "triggered_by" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "settlement_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_exports" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "file_name" TEXT,
    "content" BYTEA,
    "error" TEXT,
    "requested_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "report_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_idempotency_key_key" ON "journal_entries"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reverses_id_key" ON "journal_entries"("reverses_id");

-- CreateIndex
CREATE INDEX "journal_entries_merchant_id_occurred_at_idx" ON "journal_entries"("merchant_id", "occurred_at");

-- CreateIndex
CREATE INDEX "journal_entries_type_occurred_at_idx" ON "journal_entries"("type", "occurred_at");

-- CreateIndex
CREATE INDEX "ledger_entries_account_code_occurred_at_idx" ON "ledger_entries"("account_code", "occurred_at");

-- CreateIndex
CREATE INDEX "ledger_entries_merchant_id_account_code_idx" ON "ledger_entries"("merchant_id", "account_code");

-- CreateIndex
CREATE INDEX "cashout_requests_merchant_id_status_idx" ON "cashout_requests"("merchant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cash_deposits_reference_key" ON "cash_deposits"("reference");

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashout_requests" ADD CONSTRAINT "cashout_requests_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────── Accounting integrity rules ─────────

-- Each ledger line is a positive debit or a positive credit, never both, never zero.
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_one_side
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0));
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_account_fk
  FOREIGN KEY (account_code) REFERENCES ledger_accounts(code);
ALTER TABLE cashout_requests ADD CONSTRAINT cashout_amounts
  CHECK (amount > 0 AND fee >= 0 AND net_amount = amount - fee AND net_amount > 0);
ALTER TABLE cash_deposits ADD CONSTRAINT deposit_amount CHECK (amount > 0);

-- Every journal balances (debits = credits) and has at least two lines, checked at commit.
CREATE OR REPLACE FUNCTION check_journal_balanced() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  d bigint;
  c bigint;
  n int;
BEGIN
  SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) INTO d, c, n
    FROM ledger_entries WHERE journal_id = NEW.journal_id;
  IF d <> c THEN
    RAISE EXCEPTION 'journal % is unbalanced: debits % <> credits %', NEW.journal_id, d, c USING ERRCODE = 'check_violation';
  END IF;
  IF n < 2 THEN
    RAISE EXCEPTION 'journal % needs at least two ledger lines', NEW.journal_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON ledger_entries DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_journal_balanced();

-- Append only money tables.
CREATE TRIGGER journal_entries_append_only BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER journal_entries_no_truncate BEFORE TRUNCATE ON journal_entries
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER ledger_entries_no_truncate BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
REVOKE UPDATE ON journal_entries, ledger_entries FROM shiply_app;
REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM shiply_app;

-- Only one settlement run at a time across all API instances (acts as a distributed lock).
CREATE UNIQUE INDEX settlement_runs_one_running ON settlement_runs ((true)) WHERE status = 'RUNNING';

-- Merchants see only their own money rows; staff use the bypass flag.
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY merchant_isolation ON journal_entries
  USING (app_bypass_rls() OR merchant_id = app_merchant_id())
  WITH CHECK (app_bypass_rls());
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY merchant_isolation ON ledger_entries
  USING (app_bypass_rls() OR merchant_id = app_merchant_id())
  WITH CHECK (app_bypass_rls());
ALTER TABLE cashout_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY merchant_isolation ON cashout_requests
  USING (app_bypass_rls() OR merchant_id = app_merchant_id())
  WITH CHECK (app_bypass_rls() OR merchant_id = app_merchant_id());
-- Deposits, settlement runs and report exports are staff only.
ALTER TABLE cash_deposits ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_only ON cash_deposits USING (app_bypass_rls()) WITH CHECK (app_bypass_rls());
ALTER TABLE settlement_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_only ON settlement_runs USING (app_bypass_rls()) WITH CHECK (app_bypass_rls());
ALTER TABLE report_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_only ON report_exports USING (app_bypass_rls()) WITH CHECK (app_bypass_rls());
