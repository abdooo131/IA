-- CreateEnum
CREATE TYPE "StockMoveKind" AS ENUM ('PURCHASE', 'SALE', 'CANCELLED_SALE', 'ADJUST');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PackagingOrderStatus" AS ENUM ('PLACED', 'PACKED', 'OUT', 'DELIVERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "packaging_products" (
    "id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    "price" INTEGER NOT NULL,
    "cost" INTEGER NOT NULL DEFAULT 0,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "min_stock" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "photo" BYTEA,
    "photo_mime" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packaging_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_moves" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "kind" "StockMoveKind" NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_cost" INTEGER NOT NULL DEFAULT 0,
    "ref" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_moves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "expected_on" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "net" INTEGER NOT NULL DEFAULT 0,
    "bill_id" UUID,
    "created_by_id" UUID NOT NULL,
    "ordered_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL,
    "po_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_cost" INTEGER NOT NULL,
    "received_qty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packaging_orders" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "merchant_id" UUID NOT NULL,
    "hub_id" UUID NOT NULL,
    "status" "PackagingOrderStatus" NOT NULL DEFAULT 'PLACED',
    "payment" TEXT NOT NULL,
    "goods_total" INTEGER NOT NULL,
    "delivery_fee" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "courier_id" UUID,
    "notes" TEXT NOT NULL DEFAULT '',
    "code_checked" BOOLEAN NOT NULL DEFAULT false,
    "placed_by_id" UUID NOT NULL,
    "packed_at" TIMESTAMP(3),
    "out_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "cancel_reason" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packaging_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packaging_order_lines" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "unit_cost" INTEGER NOT NULL,

    CONSTRAINT "packaging_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "packaging_products_sku_key" ON "packaging_products"("sku");

-- CreateIndex
CREATE INDEX "stock_moves_product_id_created_at_idx" ON "stock_moves"("product_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_code_key" ON "purchase_orders"("code");

-- CreateIndex
CREATE UNIQUE INDEX "packaging_orders_code_key" ON "packaging_orders"("code");

-- CreateIndex
CREATE INDEX "packaging_orders_merchant_id_created_at_idx" ON "packaging_orders"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "packaging_orders_status_idx" ON "packaging_orders"("status");

-- AddForeignKey
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "packaging_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "packaging_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packaging_order_lines" ADD CONSTRAINT "packaging_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "packaging_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packaging_order_lines" ADD CONSTRAINT "packaging_order_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "packaging_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Packaging order and purchase order numbers.
CREATE SEQUENCE IF NOT EXISTS shop_seq START 1;

-- Accounts for packaging stock, sales and the cost of what is sold.
INSERT INTO accounts (code, name, name_ar, type, system, active, created_at) VALUES
  ('1300', 'Packaging stock', 'مخزون مواد التغليف', 'ASSET', true, true, now()),
  ('4040', 'Packaging sales', 'مبيعات مواد التغليف', 'INCOME', true, true, now()),
  ('5255', 'Cost of packaging sold', 'تكلفة مواد التغليف المباعة', 'EXPENSE', true, true, now())
ON CONFLICT (code) DO NOTHING;
