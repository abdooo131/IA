-- AlterTable
ALTER TABLE "ledger_accounts" ADD COLUMN     "petty" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "petty_cash_expenses" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "dark_store_id" TEXT NOT NULL,
    "expense_account_id" TEXT NOT NULL,
    "amount_piastres" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "photo_id" TEXT NOT NULL,
    "entry_id" TEXT,
    "request_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversal_entry_id" TEXT,
    "reversed_by_id" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reverse_reason" TEXT,

    CONSTRAINT "petty_cash_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "month_end_marks" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "marked_by_id" TEXT NOT NULL,
    "marked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "month_end_marks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "petty_cash_expenses_number_key" ON "petty_cash_expenses"("number");

-- CreateIndex
CREATE UNIQUE INDEX "petty_cash_expenses_entry_id_key" ON "petty_cash_expenses"("entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "petty_cash_expenses_request_id_key" ON "petty_cash_expenses"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "petty_cash_expenses_idempotency_key_key" ON "petty_cash_expenses"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "petty_cash_expenses_reversal_entry_id_key" ON "petty_cash_expenses"("reversal_entry_id");

-- CreateIndex
CREATE INDEX "petty_cash_expenses_dark_store_id_created_at_idx" ON "petty_cash_expenses"("dark_store_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "month_end_marks_month_item_key" ON "month_end_marks"("month", "item");

-- AddForeignKey
ALTER TABLE "petty_cash_expenses" ADD CONSTRAINT "petty_cash_expenses_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petty_cash_expenses" ADD CONSTRAINT "petty_cash_expenses_expense_account_id_fkey" FOREIGN KEY ("expense_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petty_cash_expenses" ADD CONSTRAINT "petty_cash_expenses_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "photos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petty_cash_expenses" ADD CONSTRAINT "petty_cash_expenses_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petty_cash_expenses" ADD CONSTRAINT "petty_cash_expenses_reversal_entry_id_fkey" FOREIGN KEY ("reversal_entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petty_cash_expenses" ADD CONSTRAINT "petty_cash_expenses_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "finance_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petty_cash_expenses" ADD CONSTRAINT "petty_cash_expenses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petty_cash_expenses" ADD CONSTRAINT "petty_cash_expenses_reversed_by_id_fkey" FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "month_end_marks" ADD CONSTRAINT "month_end_marks_marked_by_id_fkey" FOREIGN KEY ("marked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Petty cash is always a positive amount of money (rule 1: piastres, never negative).
ALTER TABLE "petty_cash_expenses" ADD CONSTRAINT "petty_cash_amount_positive" CHECK ("amount_piastres" > 0);
