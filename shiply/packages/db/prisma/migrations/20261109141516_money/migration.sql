-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "money";

-- CreateTable
CREATE TABLE "money"."accounts" (
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "money"."journal_entries" (
    "id" TEXT NOT NULL,
    "company_key" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "memo" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "created_by_id" TEXT,
    "reverses_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "money"."journal_lines" (
    "id" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "debit" INTEGER NOT NULL DEFAULT 0,
    "credit" INTEGER NOT NULL DEFAULT 0,
    "cost_centre_id" TEXT,
    "party_type" TEXT,
    "party_id" TEXT,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "money"."cash_holders" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref_id" TEXT,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "company_key" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "cost_centre_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_holders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "money"."handovers" (
    "id" TEXT NOT NULL,
    "from_holder_id" TEXT NOT NULL,
    "to_holder_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "confirmed_amount" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_by_id" TEXT NOT NULL,
    "confirmed_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "handovers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "money"."payouts" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "company_key" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "method" TEXT NOT NULL DEFAULT 'bank',
    "reference" TEXT,
    "prepared_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "paid_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "money"."bills" (
    "id" TEXT NOT NULL,
    "company_key" TEXT NOT NULL,
    "payee" TEXT NOT NULL,
    "supplier_ref" TEXT,
    "number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "vat" INTEGER NOT NULL DEFAULT 0,
    "account_code" TEXT NOT NULL,
    "cost_centre_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "prepared_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "paid_from_holder_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "money"."expenses" (
    "id" TEXT NOT NULL,
    "company_key" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "account_code" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "vat" INTEGER NOT NULL DEFAULT 0,
    "cost_centre_id" TEXT,
    "paid_from_holder_id" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_source_key_key" ON "money"."journal_entries"("source_key");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reverses_id_key" ON "money"."journal_entries"("reverses_id");

-- CreateIndex
CREATE INDEX "journal_entries_company_key_date_idx" ON "money"."journal_entries"("company_key", "date");

-- CreateIndex
CREATE INDEX "journal_lines_account_code_idx" ON "money"."journal_lines"("account_code");

-- CreateIndex
CREATE INDEX "journal_lines_party_type_party_id_idx" ON "money"."journal_lines"("party_type", "party_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_holders_kind_ref_id_key" ON "money"."cash_holders"("kind", "ref_id");

-- CreateIndex
CREATE INDEX "handovers_status_idx" ON "money"."handovers"("status");

-- CreateIndex
CREATE INDEX "payouts_merchant_id_status_idx" ON "money"."payouts"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "bills_status_due_date_idx" ON "money"."bills"("status", "due_date");

-- AddForeignKey
ALTER TABLE "money"."journal_lines" ADD CONSTRAINT "journal_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "money"."journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
