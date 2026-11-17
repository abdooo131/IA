-- Merchant bank details for payouts, bills in a foreign currency, equipment sold or
-- scrapped, and a supplier marked as the same company as a merchant (partner ledger).

ALTER TABLE "merchants" ADD COLUMN "bank_name" TEXT;
ALTER TABLE "merchants" ADD COLUMN "bank_account_number" TEXT;
ALTER TABLE "merchants" ADD COLUMN "iban" TEXT;
ALTER TABLE "merchants" ADD COLUMN "beneficiary_name" TEXT;

ALTER TABLE "bills" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'EGP';
-- EGP for one unit of the currency, times 1,000,000 (an exact integer, never a float)
ALTER TABLE "bills" ADD COLUMN "fx_rate_micro" BIGINT;
-- The bill in its own currency, in its smallest unit (cents)
ALTER TABLE "bills" ADD COLUMN "foreign_total" INTEGER;
ALTER TABLE "bills" ADD COLUMN "foreign_paid" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "bills" ADD CONSTRAINT "bills_currency" CHECK (
  ("currency" = 'EGP' AND "fx_rate_micro" IS NULL AND "foreign_total" IS NULL)
  OR ("currency" <> 'EGP' AND "fx_rate_micro" > 0 AND "foreign_total" > 0
      AND "foreign_paid" >= 0 AND "foreign_paid" <= "foreign_total"));

ALTER TABLE "fixed_assets" ADD COLUMN "disposed_at" TIMESTAMP(3);
ALTER TABLE "fixed_assets" ADD COLUMN "disposal_entry_id" TEXT;
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_disposal_entry_id_fkey" FOREIGN KEY ("disposal_entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "suppliers" ADD COLUMN "merchant_id" TEXT;
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "suppliers_merchant_id_key" ON "suppliers"("merchant_id");
