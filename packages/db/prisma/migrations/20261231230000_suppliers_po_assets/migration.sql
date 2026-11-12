-- Purchase orders for anything the company buys (owner, 2026-11-11): a line is packaging,
-- a cost or an asset (equipment). Receiving an asset line books Dr 1601 Cr 2401 and opens one
-- fixed asset per unit, depreciated monthly like an asset bought for cash.

CREATE TYPE "purchase_order_line_kind" AS ENUM ('packaging', 'expense', 'asset');

ALTER TABLE "purchase_order_lines"
  ADD COLUMN "kind" "purchase_order_line_kind" NOT NULL DEFAULT 'expense',
  ADD COLUMN "asset_life_months" INTEGER,
  ADD COLUMN "asset_dark_store_id" TEXT;

UPDATE "purchase_order_lines" SET "kind" = 'packaging' WHERE "packaging_item_id" IS NOT NULL;

-- Each line is exactly one kind, with the one reference its kind needs (replaces the check
-- that a line is packaging or a cost).
ALTER TABLE "purchase_order_lines" DROP CONSTRAINT "purchase_order_lines_kind";
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_kind" CHECK (
  ("kind" = 'packaging' AND "packaging_item_id" IS NOT NULL AND "expense_account_id" IS NULL
     AND "asset_life_months" IS NULL AND "asset_dark_store_id" IS NULL)
  OR ("kind" = 'expense' AND "expense_account_id" IS NOT NULL AND "packaging_item_id" IS NULL
     AND "asset_life_months" IS NULL AND "asset_dark_store_id" IS NULL)
  OR ("kind" = 'asset' AND "asset_life_months" BETWEEN 1 AND 600
     AND "packaging_item_id" IS NULL AND "expense_account_id" IS NULL)
);

ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_asset_dark_store_id_fkey"
  FOREIGN KEY ("asset_dark_store_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fixed_assets" ADD COLUMN "purchase_order_line_id" TEXT;
CREATE INDEX "fixed_assets_purchase_order_line_id_idx" ON "fixed_assets"("purchase_order_line_id");
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_purchase_order_line_id_fkey"
  FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
