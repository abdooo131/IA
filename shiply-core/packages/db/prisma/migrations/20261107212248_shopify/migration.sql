-- CreateTable
CREATE TABLE "shopify_stores" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "shop" TEXT NOT NULL,
    "token_enc" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT '',
    "auto_create" BOOLEAN NOT NULL DEFAULT true,
    "default_size" TEXT NOT NULL DEFAULT 'M',
    "push_updates" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "installed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalled_at" TIMESTAMP(3),

    CONSTRAINT "shopify_stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopify_orders" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "order_id" TEXT NOT NULL,
    "order_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT NOT NULL DEFAULT '',
    "shipment_id" UUID,
    "draft" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopify_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopify_tasks" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT NOT NULL DEFAULT '',
    "done_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopify_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shopify_stores_merchant_id_key" ON "shopify_stores"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_stores_shop_key" ON "shopify_stores"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_orders_shipment_id_key" ON "shopify_orders"("shipment_id");

-- CreateIndex
CREATE INDEX "shopify_orders_store_id_created_at_idx" ON "shopify_orders"("store_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_orders_store_id_order_id_key" ON "shopify_orders"("store_id", "order_id");

-- CreateIndex
CREATE INDEX "shopify_tasks_status_next_attempt_at_idx" ON "shopify_tasks"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_tasks_shipment_id_kind_key" ON "shopify_tasks"("shipment_id", "kind");

-- AddForeignKey
ALTER TABLE "shopify_orders" ADD CONSTRAINT "shopify_orders_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "shopify_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
