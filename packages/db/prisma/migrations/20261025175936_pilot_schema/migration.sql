-- CreateEnum
CREATE TYPE "bin_type" AS ENUM ('receiving', 'pickable', 'damaged', 'held');

-- CreateEnum
CREATE TYPE "movement_type" AS ENUM ('receive', 'move', 'reserve', 'release', 'pick', 'adjust');

-- CreateEnum
CREATE TYPE "manifest_status" AS ENUM ('draft', 'receiving', 'received', 'cancelled');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('new', 'accepted', 'picking', 'packed', 'out_for_delivery', 'delivered', 'cancelled', 'failed', 'moved_to_standard');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('prepaid', 'cod');

-- CreateEnum
CREATE TYPE "delivery_status" AS ENUM ('assigned', 'picked_up', 'delivered', 'failed');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "dark_store_id" TEXT;

-- CreateTable
CREATE TABLE "governorates" (
    "id" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,

    CONSTRAINT "governorates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dark_stores" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "address_en" TEXT NOT NULL,
    "address_ar" TEXT NOT NULL,
    "governorate_id" INTEGER NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dark_stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_hours" (
    "id" TEXT NOT NULL,
    "dark_store_id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "opens_minute" INTEGER NOT NULL,
    "closes_minute" INTEGER NOT NULL,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "store_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zones" (
    "id" TEXT NOT NULL,
    "dark_store_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "governorate_id" INTEGER NOT NULL,
    "area" geometry(MultiPolygon, 4326),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shopify_shop_domain" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skus" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "shopify_variant_id" TEXT,
    "shopify_product_id" TEXT,
    "title_en" TEXT NOT NULL,
    "title_ar" TEXT NOT NULL,
    "price_piastres" INTEGER NOT NULL,
    "weight_grams" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bins" (
    "id" TEXT NOT NULL,
    "dark_store_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "bin_type" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bin_stock" (
    "bin_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bin_stock_pkey" PRIMARY KEY ("bin_id","sku_id")
);

-- CreateTable
CREATE TABLE "stock_levels" (
    "dark_store_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "on_hand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_levels_pkey" PRIMARY KEY ("dark_store_id","sku_id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "dark_store_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "type" "movement_type" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "from_bin_id" TEXT,
    "to_bin_id" TEXT,
    "reason" TEXT,
    "order_id" TEXT,
    "manifest_id" TEXT,
    "actor_user_id" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_manifests" (
    "id" TEXT NOT NULL,
    "dark_store_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "manifest_status" NOT NULL DEFAULT 'draft',
    "expected_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbound_manifests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_manifest_lines" (
    "id" TEXT NOT NULL,
    "manifest_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "expected_qty" INTEGER NOT NULL,
    "received_qty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "inbound_manifest_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "dark_store_id" TEXT NOT NULL,
    "shopify_order_id" TEXT,
    "shopify_fulfillment_order_id" TEXT,
    "status" "order_status" NOT NULL DEFAULT 'new',
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "address_text" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "payment_method" "payment_method" NOT NULL,
    "subtotal_piastres" INTEGER NOT NULL,
    "delivery_fee_piastres" INTEGER NOT NULL DEFAULT 0,
    "cod_amount_piastres" INTEGER NOT NULL DEFAULT 0,
    "placed_at" TIMESTAMP(3) NOT NULL,
    "sla_due_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_piastres" INTEGER NOT NULL,
    "picked_qty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "from_status" "order_status",
    "to_status" "order_status",
    "actor_user_id" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "riders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "dark_store_id" TEXT NOT NULL,
    "badge_code" TEXT NOT NULL,
    "vehicle" TEXT,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "riders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "rider_id" TEXT NOT NULL,
    "status" "delivery_status" NOT NULL DEFAULT 'assigned',
    "trip_id" TEXT,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "picked_up_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "failed_reason" TEXT,
    "proof_photo_url" TEXT,
    "otp_verified" BOOLEAN NOT NULL DEFAULT false,
    "cod_collected_piastres" INTEGER,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key","scope")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "governorates_code_key" ON "governorates"("code");

-- CreateIndex
CREATE UNIQUE INDEX "dark_stores_code_key" ON "dark_stores"("code");

-- CreateIndex
CREATE UNIQUE INDEX "store_hours_dark_store_id_weekday_key" ON "store_hours"("dark_store_id", "weekday");

-- CreateIndex
CREATE INDEX "zones_area_idx" ON "zones" USING GIST ("area");

-- CreateIndex
CREATE UNIQUE INDEX "zones_dark_store_id_code_key" ON "zones"("dark_store_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_shopify_shop_domain_key" ON "merchants"("shopify_shop_domain");

-- CreateIndex
CREATE UNIQUE INDEX "skus_shopify_variant_id_key" ON "skus"("shopify_variant_id");

-- CreateIndex
CREATE INDEX "skus_barcode_idx" ON "skus"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "skus_merchant_id_sku_key" ON "skus"("merchant_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "bins_dark_store_id_code_key" ON "bins"("dark_store_id", "code");

-- CreateIndex
CREATE INDEX "bin_stock_sku_id_idx" ON "bin_stock"("sku_id");

-- CreateIndex
CREATE INDEX "stock_levels_sku_id_idx" ON "stock_levels"("sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_idempotency_key_key" ON "stock_movements"("idempotency_key");

-- CreateIndex
CREATE INDEX "stock_movements_dark_store_id_sku_id_created_at_idx" ON "stock_movements"("dark_store_id", "sku_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_order_id_idx" ON "stock_movements"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_manifests_merchant_id_reference_key" ON "inbound_manifests"("merchant_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_manifest_lines_manifest_id_sku_id_key" ON "inbound_manifest_lines"("manifest_id", "sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_number_key" ON "orders"("number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_shopify_fulfillment_order_id_key" ON "orders"("shopify_fulfillment_order_id");

-- CreateIndex
CREATE INDEX "orders_dark_store_id_status_sla_due_at_idx" ON "orders"("dark_store_id", "status", "sla_due_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_order_id_sku_id_key" ON "order_items"("order_id", "sku_id");

-- CreateIndex
CREATE INDEX "order_events_order_id_created_at_idx" ON "order_events"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "riders_user_id_key" ON "riders"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "riders_badge_code_key" ON "riders"("badge_code");

-- CreateIndex
CREATE INDEX "deliveries_rider_id_status_idx" ON "deliveries"("rider_id", "status");

-- CreateIndex
CREATE INDEX "deliveries_order_id_idx" ON "deliveries"("order_id");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_created_at_idx" ON "audit_log"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_created_at_idx" ON "audit_log"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "users_dark_store_id_idx" ON "users"("dark_store_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dark_stores" ADD CONSTRAINT "dark_stores_governorate_id_fkey" FOREIGN KEY ("governorate_id") REFERENCES "governorates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_hours" ADD CONSTRAINT "store_hours_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zones" ADD CONSTRAINT "zones_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zones" ADD CONSTRAINT "zones_governorate_id_fkey" FOREIGN KEY ("governorate_id") REFERENCES "governorates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skus" ADD CONSTRAINT "skus_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bins" ADD CONSTRAINT "bins_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bin_stock" ADD CONSTRAINT "bin_stock_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "bins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bin_stock" ADD CONSTRAINT "bin_stock_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_from_bin_id_fkey" FOREIGN KEY ("from_bin_id") REFERENCES "bins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_to_bin_id_fkey" FOREIGN KEY ("to_bin_id") REFERENCES "bins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_manifest_id_fkey" FOREIGN KEY ("manifest_id") REFERENCES "inbound_manifests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_manifests" ADD CONSTRAINT "inbound_manifests_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_manifests" ADD CONSTRAINT "inbound_manifests_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_manifest_lines" ADD CONSTRAINT "inbound_manifest_lines_manifest_id_fkey" FOREIGN KEY ("manifest_id") REFERENCES "inbound_manifests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_manifest_lines" ADD CONSTRAINT "inbound_manifest_lines_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riders" ADD CONSTRAINT "riders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riders" ADD CONSTRAINT "riders_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Rules Prisma cannot express (written by hand) ─────────────────────────────

-- Stock never goes below zero, and reservations never exceed what is on the shelf.
ALTER TABLE "bin_stock" ADD CONSTRAINT "bin_stock_quantity_non_negative" CHECK ("quantity" >= 0);
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_on_hand_non_negative" CHECK ("on_hand" >= 0);
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_reserved_non_negative" CHECK ("reserved" >= 0);
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_reserved_within_on_hand" CHECK ("reserved" <= "on_hand");

-- Movements carry a positive quantity and the bins their type needs.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_bins_match_type" CHECK (
  CASE "type"
    WHEN 'receive' THEN "from_bin_id" IS NULL AND "to_bin_id" IS NOT NULL
    WHEN 'move' THEN "from_bin_id" IS NOT NULL AND "to_bin_id" IS NOT NULL AND "from_bin_id" <> "to_bin_id"
    WHEN 'reserve' THEN "from_bin_id" IS NULL AND "to_bin_id" IS NULL
    WHEN 'release' THEN "from_bin_id" IS NULL AND "to_bin_id" IS NULL
    WHEN 'pick' THEN "from_bin_id" IS NOT NULL AND "to_bin_id" IS NULL
    WHEN 'adjust' THEN ("from_bin_id" IS NULL) <> ("to_bin_id" IS NULL)
  END
);

-- Money is integer piastres and never negative.
ALTER TABLE "skus" ADD CONSTRAINT "skus_price_non_negative" CHECK ("price_piastres" >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_money_non_negative" CHECK (
  "subtotal_piastres" >= 0 AND "delivery_fee_piastres" >= 0 AND "cod_amount_piastres" >= 0
);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_valid" CHECK (
  "quantity" > 0 AND "unit_price_piastres" >= 0 AND "picked_qty" >= 0 AND "picked_qty" <= "quantity"
);
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_cod_non_negative" CHECK (
  "cod_collected_piastres" IS NULL OR "cod_collected_piastres" >= 0
);

-- Manifests and opening hours.
ALTER TABLE "inbound_manifest_lines" ADD CONSTRAINT "inbound_manifest_lines_valid" CHECK (
  "expected_qty" >= 0 AND "received_qty" >= 0
);
ALTER TABLE "store_hours" ADD CONSTRAINT "store_hours_valid" CHECK (
  "weekday" BETWEEN 0 AND 6
  AND "opens_minute" BETWEEN 0 AND 1439
  AND "closes_minute" > "opens_minute"
  AND "closes_minute" <= 2880
);

-- Append only tables: any UPDATE or DELETE raises an error.
CREATE FUNCTION "reject_append_only_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append only; % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "stock_movements_append_only" BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_change"();
CREATE TRIGGER "order_events_append_only" BEFORE UPDATE OR DELETE ON "order_events"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_change"();
CREATE TRIGGER "audit_log_append_only" BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_change"();
