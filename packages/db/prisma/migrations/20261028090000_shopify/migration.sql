-- CreateEnum
CREATE TYPE "shopify_shop_status" AS ENUM ('pending', 'active', 'uninstalled');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "shopify_fulfillment_id" TEXT,
ADD COLUMN     "sla_starts_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "skus" ADD COLUMN     "shopify_inventory_item_id" TEXT;

-- CreateTable
CREATE TABLE "shopify_shops" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "shop_domain" TEXT NOT NULL,
    "status" "shopify_shop_status" NOT NULL DEFAULT 'pending',
    "access_token_enc" TEXT,
    "scopes" TEXT,
    "installed_at" TIMESTAMP(3),
    "uninstalled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopify_shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopify_locations" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "dark_store_id" TEXT NOT NULL,
    "fulfillment_service_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopify_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopify_stock_sync" (
    "location_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "activated" BOOLEAN NOT NULL DEFAULT false,
    "last_pushed_qty" INTEGER,
    "pushed_at" TIMESTAMP(3),
    "last_error" TEXT,

    CONSTRAINT "shopify_stock_sync_pkey" PRIMARY KEY ("location_id","sku_id")
);

-- CreateTable
CREATE TABLE "shopify_outbox" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "order_id" TEXT,
    "kind" TEXT NOT NULL,
    "payload" JSONB,
    "idempotency_key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "done_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopify_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopify_logs" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "message" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopify_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shopify_shops_merchant_id_key" ON "shopify_shops"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_shops_shop_domain_key" ON "shopify_shops"("shop_domain");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_locations_location_id_key" ON "shopify_locations"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_locations_shop_id_dark_store_id_key" ON "shopify_locations"("shop_id", "dark_store_id");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_outbox_idempotency_key_key" ON "shopify_outbox"("idempotency_key");

-- CreateIndex
CREATE INDEX "shopify_outbox_done_at_next_attempt_at_idx" ON "shopify_outbox"("done_at", "next_attempt_at");

-- CreateIndex
CREATE INDEX "shopify_logs_shop_id_created_at_idx" ON "shopify_logs"("shop_id", "created_at");

-- AddForeignKey
ALTER TABLE "shopify_shops" ADD CONSTRAINT "shopify_shops_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopify_locations" ADD CONSTRAINT "shopify_locations_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shopify_shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopify_locations" ADD CONSTRAINT "shopify_locations_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopify_stock_sync" ADD CONSTRAINT "shopify_stock_sync_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "shopify_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopify_stock_sync" ADD CONSTRAINT "shopify_stock_sync_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopify_outbox" ADD CONSTRAINT "shopify_outbox_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shopify_shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopify_outbox" ADD CONSTRAINT "shopify_outbox_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopify_logs" ADD CONSTRAINT "shopify_logs_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shopify_shops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "shopify_stock_sync" ADD CONSTRAINT "shopify_stock_sync_qty" CHECK ("last_pushed_qty" IS NULL OR "last_pushed_qty" >= 0);
ALTER TABLE "shopify_outbox" ADD CONSTRAINT "shopify_outbox_attempts" CHECK ("attempts" >= 0);
