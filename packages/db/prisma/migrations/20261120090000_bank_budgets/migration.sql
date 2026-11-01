-- Bank statements matched against the books, and monthly budgets.

CREATE TABLE "bank_statements" (
  "id" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "account_id" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "from_day" DATE NOT NULL,
  "to_day" DATE NOT NULL,
  "lines" INTEGER NOT NULL DEFAULT 0,
  "skipped" INTEGER NOT NULL DEFAULT 0,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bank_statements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bank_statements_number_key" ON "bank_statements"("number");
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_statements" ADD CONSTRAINT "bank_statements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "bank_line_status" AS ENUM ('unmatched', 'matched', 'ignored');
CREATE TABLE "bank_statement_lines" (
  "id" TEXT NOT NULL,
  "statement_id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "line_no" INTEGER NOT NULL,
  "day" DATE NOT NULL,
  "description" TEXT NOT NULL,
  "reference" TEXT,
  -- Money in positive, money out negative, as the bank shows it
  "amount_piastres" INTEGER NOT NULL,
  "balance_piastres" INTEGER,
  -- The same bank line uploaded twice (overlapping statements) is kept once
  "fingerprint" TEXT NOT NULL,
  "status" "bank_line_status" NOT NULL DEFAULT 'unmatched',
  "ledger_line_id" TEXT,
  "note" TEXT,
  "decided_by_id" TEXT,
  "decided_at" TIMESTAMP(3),
  CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bank_statement_lines_amount" CHECK ("amount_piastres" <> 0),
  CONSTRAINT "bank_statement_lines_match" CHECK (("status" = 'matched') = ("ledger_line_id" IS NOT NULL))
);
CREATE UNIQUE INDEX "bank_statement_lines_ledger_line_id_key" ON "bank_statement_lines"("ledger_line_id");
CREATE UNIQUE INDEX "bank_statement_lines_account_id_fingerprint_key" ON "bank_statement_lines"("account_id", "fingerprint");
CREATE INDEX "bank_statement_lines_account_id_status_day_idx" ON "bank_statement_lines"("account_id", "status", "day");
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "bank_statements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_ledger_line_id_fkey" FOREIGN KEY ("ledger_line_id") REFERENCES "ledger_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- What we plan to earn or spend per account, month and (optionally) store.
CREATE TABLE "budgets" (
  "id" TEXT NOT NULL,
  "month" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "dark_store_id" TEXT,
  "amount_piastres" INTEGER NOT NULL,
  "updated_by_id" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "budgets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "budgets_amount" CHECK ("amount_piastres" >= 0),
  CONSTRAINT "budgets_month" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
CREATE UNIQUE INDEX "budgets_month_account_store_key" ON "budgets"("month", "account_id", "dark_store_id") NULLS NOT DISTINCT;
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
