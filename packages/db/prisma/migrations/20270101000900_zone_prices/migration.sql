-- Every price in the Sales agreement (owner, 2026-11-08): Shiply Now's shipping fee by delivery
-- zone on contract versions, and proposals carry the zone prices of both services.
-- AlterTable
ALTER TABLE "crm_proposals" ADD COLUMN     "parcel_prices" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "zone_prices" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "merchant_contract_version_zone_prices" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "zone_id" TEXT NOT NULL,
    "price_piastres" INTEGER NOT NULL,

    CONSTRAINT "merchant_contract_version_zone_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merchant_contract_version_zone_prices_zone_id_idx" ON "merchant_contract_version_zone_prices"("zone_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_contract_version_zone_prices_version_id_zone_id_key" ON "merchant_contract_version_zone_prices"("version_id", "zone_id");

-- AddForeignKey
ALTER TABLE "merchant_contract_version_zone_prices" ADD CONSTRAINT "merchant_contract_version_zone_prices_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "merchant_contract_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_contract_version_zone_prices" ADD CONSTRAINT "merchant_contract_version_zone_prices_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "merchant_contract_version_zone_prices" ADD CONSTRAINT "merchant_contract_version_zone_prices_price" CHECK ("price_piastres" >= 0);

-- Zone prices change only on a draft, like product and next day prices.
CREATE TRIGGER "merchant_contract_version_zone_prices_frozen"
  BEFORE INSERT OR UPDATE OR DELETE ON "merchant_contract_version_zone_prices"
  FOR EACH ROW EXECUTE FUNCTION contract_product_frozen();
