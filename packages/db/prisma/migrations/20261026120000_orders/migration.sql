-- CreateEnum
CREATE TYPE "order_source" AS ENUM ('manual', 'shopify');

-- CreateEnum
CREATE TYPE "photo_kind" AS ENUM ('pack', 'delivery');

-- AlterTable
ALTER TABLE "deliveries" DROP COLUMN "proof_photo_url",
ADD COLUMN     "cod_expected_piastres" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "proof_photo_id" TEXT;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "cancelled_qty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "accepted_at" TIMESTAMP(3),
ADD COLUMN     "closed_at" TIMESTAMP(3),
ADD COLUMN     "closed_reason" TEXT,
ADD COLUMN     "created_by_id" TEXT,
ADD COLUMN     "customer_note" TEXT,
ADD COLUMN     "delivered_at" TIMESTAMP(3),
ADD COLUMN     "delivery_otp" TEXT NOT NULL DEFAULT '0000',
ADD COLUMN     "late_stage" TEXT,
ADD COLUMN     "out_for_delivery_at" TIMESTAMP(3),
ADD COLUMN     "pack_photo_id" TEXT,
ADD COLUMN     "packed_at" TIMESTAMP(3),
ADD COLUMN     "phone_flagged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "picked_at" TIMESTAMP(3),
ADD COLUMN     "picking_started_at" TIMESTAMP(3),
ADD COLUMN     "source" "order_source" NOT NULL DEFAULT 'manual',
ADD COLUMN     "zone_id" TEXT;

-- CreateTable
CREATE TABLE "photos" (
    "id" TEXT NOT NULL,
    "kind" "photo_kind" NOT NULL,
    "content_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dark_store_id" TEXT,
    "order_id" TEXT,
    "stage" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" TEXT,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alerts_resolved_at_created_at_idx" ON "alerts"("resolved_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "alerts_order_id_type_stage_key" ON "alerts"("order_id", "type", "stage");

-- CreateIndex
CREATE INDEX "orders_merchant_id_placed_at_idx" ON "orders"("merchant_id", "placed_at");

-- CreateIndex
CREATE INDEX "orders_status_placed_at_idx" ON "orders"("status", "placed_at");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_pack_photo_id_fkey" FOREIGN KEY ("pack_photo_id") REFERENCES "photos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_proof_photo_id_fkey" FOREIGN KEY ("proof_photo_id") REFERENCES "photos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─── Written by hand ───────────────────────────────────────────────────────────

-- New orders always get a real code; the default above only fills rows that existed.
ALTER TABLE "orders" ALTER COLUMN "delivery_otp" DROP DEFAULT;

-- Order numbers: SN followed by a growing number, unique without a race.
CREATE SEQUENCE "order_number_seq" START 100001;

-- Picked plus cancelled can never exceed what was ordered.
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_valid";
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_valid" CHECK (
  "quantity" > 0 AND "unit_price_piastres" >= 0 AND "picked_qty" >= 0 AND "cancelled_qty" >= 0
  AND "picked_qty" + "cancelled_qty" <= "quantity"
);

ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_cod_expected_non_negative" CHECK ("cod_expected_piastres" >= 0);

-- Photos are kept small (about 1 MB at most).
ALTER TABLE "photos" ADD CONSTRAINT "photos_size_limit" CHECK ("size_bytes" > 0 AND "size_bytes" <= 1500000);
