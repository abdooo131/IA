-- Optional VAT on an expense claim's receipt (a proper tax invoice): claimed back as input VAT
-- when the claim is paid; the person is still paid back the full amount.
ALTER TABLE "expense_claims" ADD COLUMN "vat_piastres" INTEGER;

ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_vat_check"
  CHECK ("vat_piastres" IS NULL OR ("vat_piastres" >= 0 AND "vat_piastres" < "amount_piastres"));
