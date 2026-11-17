-- Shopify sync fixes (review step 3).

-- When Shopify heard our acceptance of a fulfillment request. Orders taken before this change
-- were all accepted (or handed back, which never reads it).
ALTER TABLE "orders" ADD COLUMN "shopify_accepted_at" TIMESTAMP(3);
UPDATE "orders" SET "shopify_accepted_at" = "created_at"
  WHERE "source" = 'shopify' AND "shopify_fulfillment_order_id" IS NOT NULL;

-- A product Shopify refuses at a location waits with a growing pause and never blocks the rest.
ALTER TABLE "shopify_stock_sync" ADD COLUMN "failures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "shopify_stock_sync" ADD COLUMN "retry_at" TIMESTAMP(3);

-- Outbox calls about one order are sent in order.
CREATE INDEX "shopify_outbox_shop_id_order_id_idx" ON "shopify_outbox"("shop_id", "order_id");
