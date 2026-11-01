-- Profit per store, merchant and rider: every ledger line carries who and where it belongs
-- to. Staff advances and monthly salaries.

ALTER TABLE "ledger_lines"
  ADD COLUMN "dark_store_id" TEXT,
  ADD COLUMN "merchant_id" TEXT,
  ADD COLUMN "rider_id" TEXT,
  ADD COLUMN "user_id" TEXT;
CREATE INDEX "ledger_lines_dark_store_id_occurred_at_idx" ON "ledger_lines"("dark_store_id", "occurred_at");
CREATE INDEX "ledger_lines_merchant_id_occurred_at_idx" ON "ledger_lines"("merchant_id", "occurred_at");
CREATE INDEX "ledger_lines_rider_id_occurred_at_idx" ON "ledger_lines"("rider_id", "occurred_at");
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tag the lines already posted. Ledger rows are append only, so the guard is lifted for
-- this one backfill of the new columns.
ALTER TABLE "ledger_lines" DISABLE TRIGGER "ledger_lines_append_only";

-- From the order an entry belongs to.
UPDATE "ledger_lines" l SET "dark_store_id" = o."dark_store_id", "merchant_id" = o."merchant_id"
FROM "ledger_entries" e JOIN "orders" o ON o."id" = e."order_id"
WHERE l."entry_id" = e."id";

-- From shipments, returns, damage reports and storage days named in the entry.
UPDATE "ledger_lines" l SET "dark_store_id" = m."dark_store_id", "merchant_id" = m."merchant_id"
FROM "ledger_entries" e JOIN "inbound_manifests" m ON m."id" = e."data"->>'manifestId'
WHERE l."entry_id" = e."id" AND l."dark_store_id" IS NULL;
UPDATE "ledger_lines" l SET "dark_store_id" = r."dark_store_id", "merchant_id" = r."merchant_id"
FROM "ledger_entries" e JOIN "merchant_returns" r ON r."id" = e."data"->>'returnId'
WHERE l."entry_id" = e."id" AND l."dark_store_id" IS NULL;
UPDATE "ledger_lines" l SET "dark_store_id" = d."dark_store_id", "merchant_id" = d."merchant_id"
FROM "ledger_entries" e JOIN "damage_reports" d ON d."id" = e."data"->>'damageId'
WHERE l."entry_id" = e."id" AND l."dark_store_id" IS NULL;
UPDATE "ledger_lines" l SET "dark_store_id" = s."id"
FROM "ledger_entries" e JOIN "dark_stores" s ON s."id" = e."data"->>'darkStoreId'
WHERE l."entry_id" = e."id" AND l."dark_store_id" IS NULL;

-- From the wallets on the entry's lines: a merchant, a rider, a store's cash box.
UPDATE "ledger_lines" l SET "merchant_id" = w."merchant_id"
FROM (SELECT DISTINCT ON (x."entry_id") x."entry_id", a."merchant_id"
      FROM "ledger_lines" x JOIN "ledger_accounts" a ON a."id" = x."account_id"
      WHERE a."merchant_id" IS NOT NULL ORDER BY x."entry_id") w
WHERE l."entry_id" = w."entry_id" AND l."merchant_id" IS NULL;
UPDATE "ledger_lines" l SET "rider_id" = w."rider_id"
FROM (SELECT DISTINCT ON (x."entry_id") x."entry_id", a."rider_id"
      FROM "ledger_lines" x JOIN "ledger_accounts" a ON a."id" = x."account_id"
      WHERE a."rider_id" IS NOT NULL ORDER BY x."entry_id") w
WHERE l."entry_id" = w."entry_id";
UPDATE "ledger_lines" l SET "dark_store_id" = w."dark_store_id"
FROM (SELECT DISTINCT ON (x."entry_id") x."entry_id", a."dark_store_id"
      FROM "ledger_lines" x JOIN "ledger_accounts" a ON a."id" = x."account_id"
      WHERE a."dark_store_id" IS NOT NULL ORDER BY x."entry_id") w
WHERE l."entry_id" = w."entry_id" AND l."dark_store_id" IS NULL;
-- A rider's store, where nothing else named one.
UPDATE "ledger_lines" l SET "dark_store_id" = r."dark_store_id"
FROM "riders" r WHERE r."id" = l."rider_id" AND l."dark_store_id" IS NULL;

ALTER TABLE "ledger_lines" ENABLE TRIGGER "ledger_lines_append_only";

-- Money advanced to a team member, recovered from their salary: one wallet per person.
ALTER TYPE "ledger_account_type" ADD VALUE 'staff_advance';
ALTER TABLE "ledger_accounts" ADD COLUMN "user_id" TEXT;
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Each team member's monthly salary (gross, piastres), set by admin.
CREATE TABLE "staff_salaries" (
  "user_id" TEXT NOT NULL,
  "monthly_piastres" INTEGER NOT NULL,
  "updated_by_id" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_salaries_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "staff_salaries_amount" CHECK ("monthly_piastres" >= 0)
);
ALTER TABLE "staff_salaries" ADD CONSTRAINT "staff_salaries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_salaries" ADD CONSTRAINT "staff_salaries_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
