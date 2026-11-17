-- One customer across every merchant and our deliveries, Shopify customer records, and links from orders.
-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "customer_id" TEXT;

-- AlterTable
ALTER TABLE "shop_orders" ADD COLUMN     "customer_id" TEXT,
ADD COLUMN     "customer_shopify_id" TEXT;

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "name" TEXT NOT NULL DEFAULT '',
    "governorate" TEXT,
    "city" TEXT,
    "address" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_customers" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "shopify_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "state" TEXT,
    "orders_count" INTEGER NOT NULL DEFAULT 0,
    "amount_spent_piastres" INTEGER NOT NULL DEFAULT 0,
    "email_marketing" TEXT,
    "sms_marketing" TEXT,
    "province" TEXT,
    "city" TEXT,
    "tags" TEXT[],
    "created_at_shop" TIMESTAMP(3),
    "updated_at_shop" TIMESTAMP(3),
    "raw" JSONB NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_customers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "customers_email_key" ON "customers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "shop_customers_shopify_id_key" ON "shop_customers"("shopify_id");

-- CreateIndex
CREATE INDEX "shop_customers_customer_id_idx" ON "shop_customers"("customer_id");

-- CreateIndex
CREATE INDEX "shop_customers_merchant_id_idx" ON "shop_customers"("merchant_id");

-- CreateIndex
CREATE INDEX "orders_customer_id_idx" ON "orders"("customer_id");

-- CreateIndex
CREATE INDEX "shop_orders_customer_id_idx" ON "shop_orders"("customer_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_customers" ADD CONSTRAINT "shop_customers_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

