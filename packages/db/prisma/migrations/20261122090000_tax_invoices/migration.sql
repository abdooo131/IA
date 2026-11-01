-- Tax invoices to merchants for our fees, credit notes, and the e-invoice (ETA) state.

-- Our own details as the tax authority knows them (one row).
CREATE TABLE "company_profile" (
  "id" TEXT NOT NULL DEFAULT 'company',
  "legal_name_en" TEXT NOT NULL DEFAULT '',
  "legal_name_ar" TEXT NOT NULL DEFAULT '',
  "tax_registration_number" TEXT NOT NULL DEFAULT '',
  "activity_code" TEXT NOT NULL DEFAULT '',
  "branch_id" TEXT NOT NULL DEFAULT '0',
  "governorate" TEXT NOT NULL DEFAULT '',
  "region_city" TEXT NOT NULL DEFAULT '',
  "street" TEXT NOT NULL DEFAULT '',
  "building_number" TEXT NOT NULL DEFAULT '',
  -- The item codes registered on the e-invoice portal, per kind of fee
  "item_codes" JSONB NOT NULL DEFAULT '{}',
  "eta_enabled" BOOLEAN NOT NULL DEFAULT false,
  -- The signing program's key, stored hashed (shown once when created)
  "signer_key_hash" TEXT,
  "signer_key_created_at" TIMESTAMP(3),
  "updated_by_id" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "company_profile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "company_profile_one_row" CHECK ("id" = 'company')
);
INSERT INTO "company_profile" ("id") VALUES ('company');

ALTER TABLE "merchants" ADD COLUMN "legal_name" TEXT;
ALTER TABLE "merchants" ADD COLUMN "tax_registration_number" TEXT;
ALTER TABLE "merchants" ADD COLUMN "tax_governorate" TEXT;
ALTER TABLE "merchants" ADD COLUMN "tax_region_city" TEXT;
ALTER TABLE "merchants" ADD COLUMN "tax_street" TEXT;
ALTER TABLE "merchants" ADD COLUMN "tax_building_number" TEXT;

CREATE TYPE "tax_document_type" AS ENUM ('invoice', 'credit_note');
CREATE TYPE "eta_status" AS ENUM ('not_sent', 'signed', 'submitted', 'valid', 'invalid', 'rejected');

CREATE TABLE "tax_invoices" (
  "id" TEXT NOT NULL,
  "type" "tax_document_type" NOT NULL,
  -- INV-000001 for invoices, CN-000001 for credit notes, gapless per type
  "number" INTEGER NOT NULL,
  "merchant_id" TEXT NOT NULL,
  -- YYYY-MM for a monthly invoice; empty for a credit note
  "period_month" TEXT,
  "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "original_id" TEXT,
  "reason" TEXT,
  "net_piastres" INTEGER NOT NULL,
  "vat_piastres" INTEGER NOT NULL,
  "total_piastres" INTEGER NOT NULL,
  "entry_id" TEXT,
  "eta_status" "eta_status" NOT NULL DEFAULT 'not_sent',
  "eta_uuid" TEXT,
  "eta_long_id" TEXT,
  "eta_submission_id" TEXT,
  "eta_error" JSONB,
  "eta_checked_at" TIMESTAMP(3),
  -- The exact document sent and the text that was signed
  "document" JSONB,
  "canonical" TEXT,
  "signature" TEXT,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tax_invoices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tax_invoices_amounts" CHECK ("net_piastres" >= 0 AND "vat_piastres" >= 0
    AND "total_piastres" = "net_piastres" + "vat_piastres"),
  CONSTRAINT "tax_invoices_credit_note" CHECK (("type" = 'credit_note') = ("original_id" IS NOT NULL))
);
CREATE UNIQUE INDEX "tax_invoices_type_number_key" ON "tax_invoices"("type", "number");
CREATE UNIQUE INDEX "tax_invoices_monthly_key" ON "tax_invoices"("merchant_id", "period_month") WHERE "type" = 'invoice';
CREATE INDEX "tax_invoices_eta_status_idx" ON "tax_invoices"("eta_status");
ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_original_id_fkey" FOREIGN KEY ("original_id") REFERENCES "tax_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tax_invoices" ADD CONSTRAINT "tax_invoices_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "tax_invoice_lines" (
  "id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "line_no" INTEGER NOT NULL,
  -- The fee kind (order_fee, cod_fee, storage_fee...) or "adjustment" on a credit note
  "kind" TEXT NOT NULL,
  "description_en" TEXT NOT NULL,
  "description_ar" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "net_piastres" INTEGER NOT NULL,
  "vat_piastres" INTEGER NOT NULL,
  CONSTRAINT "tax_invoice_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tax_invoice_lines_amounts" CHECK ("quantity" > 0 AND "net_piastres" >= 0 AND "vat_piastres" >= 0)
);
CREATE UNIQUE INDEX "tax_invoice_lines_invoice_line_key" ON "tax_invoice_lines"("invoice_id", "line_no");
ALTER TABLE "tax_invoice_lines" ADD CONSTRAINT "tax_invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "tax_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- An issued document's amounts and lines never change; only its e-invoice state does.
CREATE FUNCTION tax_invoices_fixed() RETURNS trigger AS $$
BEGIN
  IF NEW.merchant_id <> OLD.merchant_id OR NEW.number <> OLD.number OR NEW.type <> OLD.type
     OR NEW.net_piastres <> OLD.net_piastres OR NEW.vat_piastres <> OLD.vat_piastres
     OR NEW.total_piastres <> OLD.total_piastres OR NEW.issued_at <> OLD.issued_at THEN
    RAISE EXCEPTION 'tax documents are fixed once issued';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER tax_invoices_fixed BEFORE UPDATE ON "tax_invoices"
  FOR EACH ROW EXECUTE FUNCTION tax_invoices_fixed();
CREATE TRIGGER tax_invoices_no_delete BEFORE DELETE ON "tax_invoices"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_change"();
CREATE TRIGGER tax_invoice_lines_append_only BEFORE UPDATE OR DELETE ON "tax_invoice_lines"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_change"();
