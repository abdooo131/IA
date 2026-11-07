-- Merchant store data from Shopify: products, variants, inventory per location, orders and lines, and each export run. No customer personal data.
-- AlterTable
ALTER TABLE "shopify_shops" ADD COLUMN     "data_synced_at" TIMESTAMP(3),
ADD COLUMN     "profile" JSONB;

-- CreateTable
CREATE TABLE "shop_data_syncs" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "bulk_operation_id" TEXT,
    "since" TIMESTAMP(3),
    "object_count" INTEGER NOT NULL DEFAULT 0,
    "limited" TEXT,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "shop_data_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_products" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "shopify_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT,
    "status" TEXT NOT NULL,
    "vendor" TEXT,
    "product_type" TEXT,
    "category_id" TEXT,
    "category_name" TEXT,
    "category_top" TEXT,
    "tags" TEXT[],
    "image_url" TEXT,
    "media_count" INTEGER NOT NULL DEFAULT 0,
    "total_inventory" INTEGER NOT NULL DEFAULT 0,
    "created_at_shop" TIMESTAMP(3),
    "updated_at_shop" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "raw" JSONB NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_variants" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "product_shopify_id" TEXT NOT NULL,
    "shopify_id" TEXT NOT NULL,
    "inventory_item_id" TEXT,
    "title" TEXT NOT NULL,
    "sku" TEXT,
    "barcode" TEXT,
    "price_piastres" INTEGER NOT NULL DEFAULT 0,
    "compare_at_piastres" INTEGER,
    "cost_piastres" INTEGER,
    "weight_grams" INTEGER,
    "inventory_quantity" INTEGER NOT NULL DEFAULT 0,
    "options" JSONB,
    "created_at_shop" TIMESTAMP(3),
    "updated_at_shop" TIMESTAMP(3),
    "raw" JSONB NOT NULL,

    CONSTRAINT "shop_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_inventory_levels" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "inventory_item_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "location_name" TEXT NOT NULL,
    "ours" BOOLEAN NOT NULL DEFAULT false,
    "available" INTEGER NOT NULL DEFAULT 0,
    "on_hand" INTEGER NOT NULL DEFAULT 0,
    "committed" INTEGER NOT NULL DEFAULT 0,
    "incoming" INTEGER NOT NULL DEFAULT 0,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_inventory_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_orders" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "shopify_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at_shop" TIMESTAMP(3) NOT NULL,
    "processed_at" TIMESTAMP(3),
    "updated_at_shop" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "financial_status" TEXT,
    "fulfillment_status" TEXT,
    "currency" TEXT NOT NULL,
    "subtotal_piastres" INTEGER NOT NULL DEFAULT 0,
    "discounts_piastres" INTEGER NOT NULL DEFAULT 0,
    "shipping_piastres" INTEGER NOT NULL DEFAULT 0,
    "tax_piastres" INTEGER NOT NULL DEFAULT 0,
    "total_piastres" INTEGER NOT NULL DEFAULT 0,
    "refunded_piastres" INTEGER NOT NULL DEFAULT 0,
    "units" INTEGER NOT NULL DEFAULT 0,
    "source_name" TEXT,
    "province" TEXT,
    "city" TEXT,
    "country" TEXT,
    "tags" TEXT[],
    "test" BOOLEAN NOT NULL DEFAULT false,
    "raw" JSONB NOT NULL,

    CONSTRAINT "shop_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_order_lines" (
    "id" TEXT NOT NULL,
    "order_shopify_id" TEXT NOT NULL,
    "shopify_id" TEXT NOT NULL,
    "product_shopify_id" TEXT,
    "variant_shopify_id" TEXT,
    "sku" TEXT,
    "title" TEXT NOT NULL,
    "vendor" TEXT,
    "quantity" INTEGER NOT NULL,
    "current_quantity" INTEGER NOT NULL,
    "unit_price_piastres" INTEGER NOT NULL,
    "discount_piastres" INTEGER NOT NULL DEFAULT 0,
    "total_piastres" INTEGER NOT NULL,

    CONSTRAINT "shop_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shop_data_syncs_shop_id_kind_started_at_idx" ON "shop_data_syncs"("shop_id", "kind", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "shop_products_shopify_id_key" ON "shop_products"("shopify_id");

-- CreateIndex
CREATE INDEX "shop_products_merchant_id_status_idx" ON "shop_products"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "shop_products_category_top_idx" ON "shop_products"("category_top");

-- CreateIndex
CREATE UNIQUE INDEX "shop_variants_shopify_id_key" ON "shop_variants"("shopify_id");

-- CreateIndex
CREATE UNIQUE INDEX "shop_variants_inventory_item_id_key" ON "shop_variants"("inventory_item_id");

-- CreateIndex
CREATE INDEX "shop_variants_shop_id_sku_idx" ON "shop_variants"("shop_id", "sku");

-- CreateIndex
CREATE INDEX "shop_inventory_levels_shop_id_idx" ON "shop_inventory_levels"("shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "shop_inventory_levels_inventory_item_id_location_id_key" ON "shop_inventory_levels"("inventory_item_id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "shop_orders_shopify_id_key" ON "shop_orders"("shopify_id");

-- CreateIndex
CREATE INDEX "shop_orders_merchant_id_created_at_shop_idx" ON "shop_orders"("merchant_id", "created_at_shop");

-- CreateIndex
CREATE UNIQUE INDEX "shop_order_lines_shopify_id_key" ON "shop_order_lines"("shopify_id");

-- CreateIndex
CREATE INDEX "shop_order_lines_product_shopify_id_idx" ON "shop_order_lines"("product_shopify_id");

-- AddForeignKey
ALTER TABLE "shop_data_syncs" ADD CONSTRAINT "shop_data_syncs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shopify_shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_variants" ADD CONSTRAINT "shop_variants_product_shopify_id_fkey" FOREIGN KEY ("product_shopify_id") REFERENCES "shop_products"("shopify_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order_lines" ADD CONSTRAINT "shop_order_lines_order_shopify_id_fkey" FOREIGN KEY ("order_shopify_id") REFERENCES "shop_orders"("shopify_id") ON DELETE CASCADE ON UPDATE CASCADE;

