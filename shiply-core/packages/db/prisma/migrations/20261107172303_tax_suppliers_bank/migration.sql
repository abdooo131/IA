-- AlterEnum
ALTER TYPE "PartyType" ADD VALUE 'SUPPLIER';

-- AlterTable
ALTER TABLE "agent_settlements" ADD COLUMN     "advances" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "tax_id" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "tax_invoices" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "merchant_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "issue_date" TEXT NOT NULL,
    "net" INTEGER NOT NULL,
    "vat" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "lines" JSONB NOT NULL,
    "ref_invoice_id" UUID,
    "reason" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "eta_status" TEXT NOT NULL DEFAULT 'NOT_SENT',
    "eta_uuid" TEXT NOT NULL DEFAULT '',
    "created_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tax_id" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "bank_name" TEXT NOT NULL DEFAULT '',
    "iban" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bills" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "number" TEXT NOT NULL DEFAULT '',
    "date" TEXT NOT NULL,
    "due_date" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "net" INTEGER NOT NULL,
    "vat" INTEGER NOT NULL,
    "wht_bp" INTEGER NOT NULL DEFAULT 0,
    "wht" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "payable" INTEGER NOT NULL,
    "hub_id" UUID,
    "note" TEXT NOT NULL DEFAULT '',
    "attachment" BYTEA,
    "mime" TEXT NOT NULL DEFAULT '',
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "created_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_imports" (
    "id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "rows" INTEGER NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_lines" (
    "id" UUID NOT NULL,
    "import_id" UUID NOT NULL,
    "date" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "amount" INTEGER NOT NULL,
    "matched_line_id" UUID,
    "matched_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" UUID NOT NULL,
    "account_code" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_advances" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "agent_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "note" TEXT NOT NULL DEFAULT '',
    "requested_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "settlement_id" UUID,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_advances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_invoices_number_key" ON "tax_invoices"("number");

-- CreateIndex
CREATE INDEX "tax_invoices_merchant_id_month_idx" ON "tax_invoices"("merchant_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "bills_code_key" ON "bills"("code");

-- CreateIndex
CREATE INDEX "bills_status_idx" ON "bills"("status");

-- CreateIndex
CREATE UNIQUE INDEX "bank_lines_matched_line_id_key" ON "bank_lines"("matched_line_id");

-- CreateIndex
CREATE INDEX "bank_lines_date_idx" ON "bank_lines"("date");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_account_code_month_key" ON "budgets"("account_code", "month");

-- CreateIndex
CREATE UNIQUE INDEX "agent_advances_code_key" ON "agent_advances"("code");

-- CreateIndex
CREATE INDEX "agent_advances_agent_id_idx" ON "agent_advances"("agent_id");

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "bank_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE SEQUENCE IF NOT EXISTS invoice_seq START 1;
