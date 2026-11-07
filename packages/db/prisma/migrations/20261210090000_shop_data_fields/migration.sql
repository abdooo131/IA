-- Shopify order and customer fields we used to skip (docs/SHOPIFY_DATA.md).
ALTER TABLE "shop_orders"
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION,
  ADD COLUMN "point_source" TEXT,
  ADD COLUMN "payment_gateways" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "payment_method" TEXT,
  ADD COLUMN "shipping_code" TEXT,
  ADD COLUMN "shipping_title" TEXT,
  ADD COLUMN "express" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "discount_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "cancel_reason" TEXT,
  ADD COLUMN "custom_attributes" JSONB;

ALTER TABLE "shop_customers" ADD COLUMN "locale" TEXT;

-- Own orders of one Shopify customer record (the floor from Shopify's totals).
CREATE INDEX "shop_orders_customer_shopify_id_idx" ON "shop_orders"("customer_shopify_id");
