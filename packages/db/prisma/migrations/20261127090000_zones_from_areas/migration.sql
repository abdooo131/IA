-- Zones built from areas, one delivery decision (docs/ZONES.md).
-- Hand made indexes bills_supplier_reference_user_key and budgets_month_account_store_key stay.

-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "delivered_lat" DOUBLE PRECISION,
ADD COLUMN     "delivered_lng" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "geo_areas" ADD COLUMN     "merged_into_id" TEXT;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "geo_area_id" TEXT,
ADD COLUMN     "location_source" TEXT,
ADD COLUMN     "resolved_by" TEXT;

-- AlterTable
ALTER TABLE "zones" ADD COLUMN     "legacy_area" geometry(MultiPolygon, 4326);

-- CreateTable
CREATE TABLE "store_areas" (
    "geo_area_id" TEXT NOT NULL,
    "dark_store_id" TEXT,
    "zone_id" TEXT,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_areas_pkey" PRIMARY KEY ("geo_area_id")
);

-- CreateTable
CREATE TABLE "delivered_points" (
    "order_id" TEXT NOT NULL,
    "address_key" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivered_points_pkey" PRIMARY KEY ("order_id")
);

-- CreateIndex
CREATE INDEX "store_areas_zone_id_idx" ON "store_areas"("zone_id");

-- CreateIndex
CREATE INDEX "store_areas_dark_store_id_idx" ON "store_areas"("dark_store_id");

-- CreateIndex
CREATE INDEX "delivered_points_address_key_idx" ON "delivered_points"("address_key");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_geo_area_id_fkey" FOREIGN KEY ("geo_area_id") REFERENCES "geo_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geo_areas" ADD CONSTRAINT "geo_areas_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "geo_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_areas" ADD CONSTRAINT "store_areas_geo_area_id_fkey" FOREIGN KEY ("geo_area_id") REFERENCES "geo_areas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_areas" ADD CONSTRAINT "store_areas_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_areas" ADD CONSTRAINT "store_areas_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_areas" ADD CONSTRAINT "store_areas_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivered_points" ADD CONSTRAINT "delivered_points_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A row names a store and its zone together, or neither (the area is marked not served).
ALTER TABLE "store_areas" ADD CONSTRAINT "store_areas_store_and_zone_check"
  CHECK (("dark_store_id" IS NULL) = ("zone_id" IS NULL));

-- The hand drawn outlines are kept for one release; areas are assigned from them by
-- assignAreasFromOutlines (packages/db/src/geo/zone-areas.ts) when the API starts.
UPDATE "zones" SET "legacy_area" = "area" WHERE "area" IS NOT NULL;
