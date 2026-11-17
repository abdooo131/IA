-- Suppliers and their bills (paid later, with withholding tax), recurring entries,
-- prepayments spread over months, and fixed assets depreciated monthly.

ALTER TYPE "ledger_account_type" ADD VALUE 'supplier';
ALTER TABLE "ledger_accounts" ADD COLUMN "supplier_id" TEXT;

CREATE TABLE "suppliers" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tax_id" TEXT,
  "phone" TEXT,
  "email" TEXT,
  -- Withholding tax deducted from each payment, basis points of the amount before VAT
  "wht_bp" INTEGER NOT NULL DEFAULT 0,
  "default_expense_account_id" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "suppliers_wht" CHECK ("wht_bp" >= 0 AND "wht_bp" <= 10000)
);
CREATE UNIQUE INDEX "suppliers_name_key" ON "suppliers"("name");
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_default_expense_account_id_fkey" FOREIGN KEY ("default_expense_account_id") REFERENCES "ledger_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "bill_status" AS ENUM ('open', 'paid', 'cancelled');
CREATE TABLE "bills" (
  "id" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "supplier_id" TEXT NOT NULL,
  -- The supplier's own invoice number
  "reference" TEXT NOT NULL,
  "bill_date" DATE NOT NULL,
  "due_date" DATE NOT NULL,
  "expense_account_id" TEXT NOT NULL,
  "dark_store_id" TEXT,
  "net_piastres" INTEGER NOT NULL,
  "vat_piastres" INTEGER NOT NULL DEFAULT 0,
  "total_piastres" INTEGER NOT NULL,
  "wht_bp" INTEGER NOT NULL DEFAULT 0,
  "paid_piastres" INTEGER NOT NULL DEFAULT 0,
  "status" "bill_status" NOT NULL DEFAULT 'open',
  "memo" TEXT,
  "entry_id" TEXT,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bills_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bills_amounts" CHECK ("net_piastres" > 0 AND "vat_piastres" >= 0
    AND "total_piastres" = "net_piastres" + "vat_piastres"
    AND "paid_piastres" >= 0 AND "paid_piastres" <= "total_piastres"),
  CONSTRAINT "bills_due" CHECK ("due_date" >= "bill_date")
);
CREATE UNIQUE INDEX "bills_number_key" ON "bills"("number");
CREATE UNIQUE INDEX "bills_supplier_id_reference_key" ON "bills"("supplier_id", "reference");
CREATE INDEX "bills_status_due_date_idx" ON "bills"("status", "due_date");
ALTER TABLE "bills" ADD CONSTRAINT "bills_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bills" ADD CONSTRAINT "bills_expense_account_id_fkey" FOREIGN KEY ("expense_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bills" ADD CONSTRAINT "bills_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bills" ADD CONSTRAINT "bills_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bills" ADD CONSTRAINT "bills_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An expense that repeats every month (rent, internet), prepared on its day for approval.
CREATE TABLE "recurring_entries" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  -- The expense as entered once (accounts, amount, VAT, store, memo)
  "payload" JSONB NOT NULL,
  "amount_piastres" INTEGER NOT NULL,
  "day_of_month" INTEGER NOT NULL,
  "start_month" TEXT NOT NULL,
  "end_month" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recurring_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recurring_entries_day" CHECK ("day_of_month" BETWEEN 1 AND 28),
  CONSTRAINT "recurring_entries_amount" CHECK ("amount_piastres" > 0)
);
ALTER TABLE "recurring_entries" ADD CONSTRAINT "recurring_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Paid ahead (a year's rent): kept as an asset and moved to expense month by month.
CREATE TABLE "prepayments" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "expense_account_id" TEXT NOT NULL,
  "dark_store_id" TEXT,
  "total_piastres" INTEGER NOT NULL,
  "months" INTEGER NOT NULL,
  "start_month" TEXT NOT NULL,
  "entry_id" TEXT NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "prepayments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "prepayments_amount" CHECK ("total_piastres" > 0 AND "months" BETWEEN 1 AND 120)
);
ALTER TABLE "prepayments" ADD CONSTRAINT "prepayments_expense_account_id_fkey" FOREIGN KEY ("expense_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prepayments" ADD CONSTRAINT "prepayments_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prepayments" ADD CONSTRAINT "prepayments_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prepayments" ADD CONSTRAINT "prepayments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Shelves, fridges, phones, motorbikes: bought once, depreciated straight line monthly.
CREATE TABLE "fixed_assets" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "cost_piastres" INTEGER NOT NULL,
  "salvage_piastres" INTEGER NOT NULL DEFAULT 0,
  "life_months" INTEGER NOT NULL,
  "start_month" TEXT NOT NULL,
  "dark_store_id" TEXT,
  "entry_id" TEXT NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fixed_assets_amounts" CHECK ("cost_piastres" > 0 AND "salvage_piastres" >= 0
    AND "salvage_piastres" < "cost_piastres" AND "life_months" BETWEEN 1 AND 600)
);
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
