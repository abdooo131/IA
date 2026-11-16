-- Security fixes (code review, 2026-11-16).

-- Wrong delivery codes per delivery: at delivery.max_wrong_codes the code is locked.
ALTER TABLE "deliveries" ADD COLUMN "otp_failures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_otp_failures_check" CHECK ("otp_failures" >= 0);

-- The merchant who saved a Shopify app (merchant self service); null: added by admin.
ALTER TABLE "shopify_apps" ADD COLUMN "merchant_id" TEXT;
ALTER TABLE "shopify_apps" ADD CONSTRAINT "shopify_apps_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "shopify_apps_merchant_id_idx" ON "shopify_apps"("merchant_id");

-- Existing apps belong to the merchant of their stores when they serve exactly one merchant.
UPDATE "shopify_apps" a
SET "merchant_id" = s."merchant_id"
FROM (
  SELECT "app_id", MIN("merchant_id") AS "merchant_id"
  FROM "shopify_shops"
  WHERE "app_id" IS NOT NULL
  GROUP BY "app_id"
  HAVING COUNT(DISTINCT "merchant_id") = 1
) s
WHERE s."app_id" = a."id";
