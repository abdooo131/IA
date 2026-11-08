-- One contract for both services (docs/MERGE.md step 6): a version also holds the next day
-- terms of Shiply (discount on list prices, cash collection and return fees, fixed prices per
-- zone and size). Null keeps the network's volume tier and settings.
-- AlterTable
ALTER TABLE "merchant_contract_versions" ADD COLUMN     "parcel_cod_fee_bp" INTEGER,
ADD COLUMN     "parcel_discount_bp" INTEGER,
ADD COLUMN     "parcel_return_fee_bp" INTEGER;

-- CreateTable
CREATE TABLE "merchant_contract_version_parcel_prices" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "zone_code" TEXT NOT NULL,
    "size" "ParcelSize" NOT NULL,
    "price_piastres" INTEGER NOT NULL,

    CONSTRAINT "merchant_contract_version_parcel_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "merchant_contract_version_parcel_prices_version_id_zone_cod_key" ON "merchant_contract_version_parcel_prices"("version_id", "zone_code", "size");

-- AddForeignKey
ALTER TABLE "merchant_contract_version_parcel_prices" ADD CONSTRAINT "merchant_contract_version_parcel_prices_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "merchant_contract_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_contract_version_parcel_prices" ADD CONSTRAINT "merchant_contract_version_parcel_prices_zone_code_fkey" FOREIGN KEY ("zone_code") REFERENCES "pricing_zones"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "merchant_contract_versions" ADD CONSTRAINT "merchant_contract_versions_parcels" CHECK (
  COALESCE("parcel_discount_bp", 0) BETWEEN 0 AND 10000
  AND COALESCE("parcel_cod_fee_bp", 0) BETWEEN 0 AND 10000
  AND COALESCE("parcel_return_fee_bp", 0) BETWEEN 0 AND 10000
);
ALTER TABLE "merchant_contract_version_parcel_prices" ADD CONSTRAINT "merchant_contract_version_parcel_prices_price" CHECK ("price_piastres" >= 0);

-- An activated version never changes: the next day terms are frozen with the others.
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
     OLD.shipping_fee_piastres, OLD.packaging_charge_piastres, OLD.failed_delivery_percent_bp,
     OLD.parcel_discount_bp, OLD.parcel_cod_fee_bp, OLD.parcel_return_fee_bp)
    IS DISTINCT FROM
    (NEW.order_fixed_piastres, NEW.order_percent_bp, NEW.cod_percent_bp,
     NEW.failed_delivery_piastres, NEW.receiving_per_unit_piastres,
     NEW.storage_per_unit_month_piastres, NEW.return_per_unit_piastres, NEW.payout_schedule,
     NEW.minimum_payout_piastres, NEW.minimum_monthly_fee_piastres,
     NEW.security_deposit_piastres, NEW.credit_limit_piastres, NEW.promise_minutes,
     NEW.delivery_attempts, NEW.store_ids, NEW.coverage_note, NEW.terms, NEW.start_date,
     NEW.end_date, NEW.notice_days, NEW.effective_from, NEW.version, NEW.contract_id,
     NEW.shipping_fee_piastres, NEW.packaging_charge_piastres, NEW.failed_delivery_percent_bp,
     NEW.parcel_discount_bp, NEW.parcel_cod_fee_bp, NEW.parcel_return_fee_bp)
    OR NEW.status = 'draft'
  ) THEN
    RAISE EXCEPTION 'contract_version_frozen' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Next day prices change only on a draft, like product prices.
CREATE TRIGGER "merchant_contract_version_parcel_prices_frozen"
  BEFORE INSERT OR UPDATE OR DELETE ON "merchant_contract_version_parcel_prices"
  FOR EACH ROW EXECUTE FUNCTION contract_product_frozen();
