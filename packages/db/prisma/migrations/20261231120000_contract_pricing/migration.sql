-- Contract pricing (CLAUDE.md "Merchant contracts v2", contract pricing): a shipping fee per
-- delivered order (often all inclusive, the other fees then an explicit 0), a packaging charge,
-- the failed delivery share of the shipment charges, and per product prices on each version.
-- Proposals carry the same. Existing versions keep exactly their charges: every new column is
-- empty (the standard shipping fee and packaging charge are 0, and without a shipping fee a
-- failed delivery costs the fixed fee as before) and no version has product prices.

-- AlterTable
ALTER TABLE "crm_proposal_tiers" ADD COLUMN     "packaging_charge_piastres" INTEGER,
ADD COLUMN     "shipping_fee_piastres" INTEGER;

-- AlterTable
ALTER TABLE "crm_proposals" ADD COLUMN     "failed_delivery_percent_bp" INTEGER,
ADD COLUMN     "packaging_charge_piastres" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shipping_fee_piastres" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "merchant_contract_version_tiers" ADD COLUMN     "packaging_charge_piastres" INTEGER,
ADD COLUMN     "shipping_fee_piastres" INTEGER;

-- AlterTable
ALTER TABLE "merchant_contract_versions" ADD COLUMN     "failed_delivery_percent_bp" INTEGER,
ADD COLUMN     "packaging_charge_piastres" INTEGER,
ADD COLUMN     "shipping_fee_piastres" INTEGER;

-- CreateTable
CREATE TABLE "merchant_contract_version_products" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "price_piastres" INTEGER NOT NULL,

    CONSTRAINT "merchant_contract_version_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_proposal_products" (
    "id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "sku_id" TEXT,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price_piastres" INTEGER NOT NULL,
    "matched_sku_id" TEXT,
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "crm_proposal_products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merchant_contract_version_products_sku_id_idx" ON "merchant_contract_version_products"("sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_contract_version_products_version_id_sku_id_key" ON "merchant_contract_version_products"("version_id", "sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_proposal_products_proposal_id_position_key" ON "crm_proposal_products"("proposal_id", "position");

-- AddForeignKey
ALTER TABLE "merchant_contract_version_products" ADD CONSTRAINT "merchant_contract_version_products_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "merchant_contract_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_contract_version_products" ADD CONSTRAINT "merchant_contract_version_products_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposal_products" ADD CONSTRAINT "crm_proposal_products_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "crm_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposal_products" ADD CONSTRAINT "crm_proposal_products_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Money never negative, shares at most 100%.
ALTER TABLE "merchant_contract_versions" ADD CONSTRAINT "merchant_contract_versions_pricing" CHECK (
  COALESCE("shipping_fee_piastres", 0) >= 0
  AND COALESCE("packaging_charge_piastres", 0) >= 0
  AND COALESCE("failed_delivery_percent_bp", 0) BETWEEN 0 AND 10000
);
ALTER TABLE "merchant_contract_version_tiers" ADD CONSTRAINT "merchant_contract_version_tiers_pricing" CHECK (
  COALESCE("shipping_fee_piastres", 0) >= 0 AND COALESCE("packaging_charge_piastres", 0) >= 0
);
ALTER TABLE "merchant_contract_version_products" ADD CONSTRAINT "merchant_contract_version_products_price" CHECK ("price_piastres" >= 0);
ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_pricing" CHECK (
  "shipping_fee_piastres" >= 0 AND "packaging_charge_piastres" >= 0
  AND COALESCE("failed_delivery_percent_bp", 0) BETWEEN 0 AND 10000
);
ALTER TABLE "crm_proposal_tiers" ADD CONSTRAINT "crm_proposal_tiers_pricing" CHECK (
  COALESCE("shipping_fee_piastres", 0) >= 0 AND COALESCE("packaging_charge_piastres", 0) >= 0
);
ALTER TABLE "crm_proposal_products" ADD CONSTRAINT "crm_proposal_products_price" CHECK ("price_piastres" >= 0);

-- An activated version never changes: the new prices are frozen with the others.
CREATE OR REPLACE FUNCTION contract_version_frozen() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'contract_version_frozen' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'draft' AND (
    (OLD.order_fixed_piastres, OLD.order_percent_bp, OLD.cod_percent_bp,
     OLD.failed_delivery_piastres, OLD.receiving_per_unit_piastres,
     OLD.storage_per_unit_month_piastres, OLD.return_per_unit_piastres, OLD.payout_schedule,
     OLD.minimum_payout_piastres, OLD.minimum_monthly_fee_piastres,
     OLD.security_deposit_piastres, OLD.credit_limit_piastres, OLD.promise_minutes,
     OLD.delivery_attempts, OLD.store_ids, OLD.coverage_note, OLD.terms, OLD.start_date,
     OLD.end_date, OLD.notice_days, OLD.effective_from, OLD.version, OLD.contract_id,
     OLD.shipping_fee_piastres, OLD.packaging_charge_piastres, OLD.failed_delivery_percent_bp)
    IS DISTINCT FROM
    (NEW.order_fixed_piastres, NEW.order_percent_bp, NEW.cod_percent_bp,
     NEW.failed_delivery_piastres, NEW.receiving_per_unit_piastres,
     NEW.storage_per_unit_month_piastres, NEW.return_per_unit_piastres, NEW.payout_schedule,
     NEW.minimum_payout_piastres, NEW.minimum_monthly_fee_piastres,
     NEW.security_deposit_piastres, NEW.credit_limit_piastres, NEW.promise_minutes,
     NEW.delivery_attempts, NEW.store_ids, NEW.coverage_note, NEW.terms, NEW.start_date,
     NEW.end_date, NEW.notice_days, NEW.effective_from, NEW.version, NEW.contract_id,
     NEW.shipping_fee_piastres, NEW.packaging_charge_piastres, NEW.failed_delivery_percent_bp)
    OR NEW.status = 'draft'
  ) THEN
    RAISE EXCEPTION 'contract_version_frozen' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Product prices change only on a draft (and go with the draft when it is deleted).
CREATE FUNCTION contract_product_frozen() RETURNS trigger AS $$
DECLARE
  v_status "contract_version_status";
BEGIN
  SELECT status INTO v_status FROM "merchant_contract_versions"
    WHERE id = COALESCE(NEW.version_id, OLD.version_id);
  IF v_status IS NOT NULL AND v_status <> 'draft' THEN
    RAISE EXCEPTION 'contract_version_frozen' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER merchant_contract_version_products_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON "merchant_contract_version_products"
  FOR EACH ROW EXECUTE FUNCTION contract_product_frozen();
