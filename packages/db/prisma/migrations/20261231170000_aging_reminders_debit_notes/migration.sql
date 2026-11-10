-- Aging reports, payment reminders to merchants who owe us, and debit notes.

-- Debit notes (DN-000001) live with invoices and credit notes in tax_invoices: the same
-- gapless numbering per type, the same fixed amounts trigger and the same e-invoice flow
-- (ETA document type "D"). Like a credit note, a debit note always names the invoice it adds
-- to (ETA needs the original document's uuid).
ALTER TYPE "tax_document_type" ADD VALUE 'debit_note';

-- The new enum value cannot be used in this transaction, so the check compares the text.
ALTER TABLE "tax_invoices" DROP CONSTRAINT "tax_invoices_credit_note";
ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_credit_note"
  CHECK (("type"::text IN ('credit_note', 'debit_note')) = ("original_id" IS NOT NULL));

-- One row per payment reminder sent to a merchant whose wallet is in debit.
CREATE TABLE "merchant_payment_reminders" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  -- When the wallet last turned to debit: reminders are counted per debit period
  "period_start" TIMESTAMP(3) NOT NULL,
  "number" INTEGER NOT NULL,
  "amount_piastres" INTEGER NOT NULL,
  "manual" BOOLEAN NOT NULL DEFAULT false,
  "sent_by_id" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "merchant_payment_reminders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "merchant_payment_reminders_amounts" CHECK ("number" > 0 AND "amount_piastres" > 0)
);
CREATE UNIQUE INDEX "merchant_payment_reminders_idempotency_key_key"
  ON "merchant_payment_reminders"("idempotency_key");
CREATE INDEX "merchant_payment_reminders_merchant_id_period_start_idx"
  ON "merchant_payment_reminders"("merchant_id", "period_start");
ALTER TABLE "merchant_payment_reminders" ADD CONSTRAINT "merchant_payment_reminders_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
