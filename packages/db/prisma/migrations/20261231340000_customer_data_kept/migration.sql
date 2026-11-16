-- Customer data is never deleted from our side (owner, 2026-11-16). Shopify's customers/redact
-- and shop/redact now hide the buyer from every merchant view instead of deleting or scrubbing:
-- the rows keep everything for the company and carry when they were redacted.

ALTER TABLE "shop_customers" ADD COLUMN "redacted_at" TIMESTAMP(3);
ALTER TABLE "shop_customers" ADD COLUMN "shop_domain" TEXT;
ALTER TABLE "shop_orders" ADD COLUMN "redacted_at" TIMESTAMP(3);
ALTER TABLE "shop_orders" ADD COLUMN "shop_domain" TEXT;
-- Our own delivery orders whose Shopify buyer asked to be forgotten: merchants no longer see
-- the buyer's details on them.
ALTER TABLE "orders" ADD COLUMN "buyer_redacted_at" TIMESTAMP(3);

-- The store each record came from, so a redact request still finds its rows after the store
-- was disconnected or the merchant moved to another store (the shop row is then gone or reused).
UPDATE "shop_customers" sc SET "shop_domain" = s."shop_domain"
  FROM "shopify_shops" s WHERE s."id" = sc."shop_id";
UPDATE "shop_orders" so SET "shop_domain" = s."shop_domain"
  FROM "shopify_shops" s WHERE s."id" = so."shop_id";

CREATE INDEX "shop_customers_shop_domain_idx" ON "shop_customers"("shop_domain");
CREATE INDEX "shop_orders_shop_domain_idx" ON "shop_orders"("shop_domain");
