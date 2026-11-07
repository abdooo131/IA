-- Access rights (docs/ACCESS.md): a profile per team member (admin, finance and store staff
-- accounts) with a level per app, the stores they work in, and owner or member rights for
-- merchant users. users.finance_level stays for history; user_access.accounting replaces it.

-- CreateEnum
CREATE TYPE "access_level" AS ENUM ('none', 'view', 'use', 'manage');

-- CreateEnum
CREATE TYPE "merchant_role" AS ENUM ('owner', 'member');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "merchant_rights" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "merchant_role" "merchant_role";

-- CreateTable
CREATE TABLE "user_access" (
    "user_id" TEXT NOT NULL,
    "job_role" TEXT NOT NULL,
    "store" "access_level" NOT NULL DEFAULT 'none',
    "operations" "access_level" NOT NULL DEFAULT 'none',
    "inventory" "access_level" NOT NULL DEFAULT 'none',
    "merchants" "access_level" NOT NULL DEFAULT 'none',
    "customers" "access_level" NOT NULL DEFAULT 'none',
    "accounting" "access_level" NOT NULL DEFAULT 'none',
    "settings" "access_level" NOT NULL DEFAULT 'none',
    "all_stores" BOOLEAN NOT NULL DEFAULT false,
    "customer_data" BOOLEAN NOT NULL DEFAULT false,
    "salaries" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_access_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "user_stores" (
    "user_id" TEXT NOT NULL,
    "dark_store_id" TEXT NOT NULL,

    CONSTRAINT "user_stores_pkey" PRIMARY KEY ("user_id","dark_store_id")
);

-- CreateIndex
CREATE INDEX "user_stores_dark_store_id_idx" ON "user_stores"("dark_store_id");

-- AddForeignKey
ALTER TABLE "user_access" ADD CONSTRAINT "user_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_stores" ADD CONSTRAINT "user_stores_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_stores" ADD CONSTRAINT "user_stores_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The store screens have no read only level; settings are all or nothing.
ALTER TABLE "user_access" ADD CONSTRAINT "user_access_store_level_check" CHECK ("store" <> 'view');
ALTER TABLE "user_access" ADD CONSTRAINT "user_access_settings_level_check" CHECK ("settings" IN ('none', 'manage'));
-- Merchant rights are only these words.
ALTER TABLE "users" ADD CONSTRAINT "users_merchant_rights_check"
  CHECK ("merchant_rights" <@ ARRAY['orders', 'stock', 'money', 'settings']::TEXT[]);

-- ─── Moving existing users (docs/ACCESS.md) ──────────────────────────────────────

-- admin → Owner.
INSERT INTO "user_access" ("user_id", "job_role", "store", "operations", "inventory", "merchants",
  "customers", "accounting", "settings", "all_stores", "customer_data", "salaries", "updated_at")
SELECT "id", 'owner', 'manage', 'manage', 'manage', 'manage', 'manage', 'manage', 'manage',
  true, true, true, CURRENT_TIMESTAMP
FROM "users" WHERE "role" = 'admin';

-- finance → Finance manager (approve), Finance officer (prepare: accounting use) or, for view,
-- the same row with accounting view, which is the Accountant job role.
INSERT INTO "user_access" ("user_id", "job_role", "store", "operations", "inventory", "merchants",
  "customers", "accounting", "settings", "all_stores", "customer_data", "salaries", "updated_at")
SELECT "id",
  CASE "finance_level" WHEN 'approve' THEN 'finance_manager'
    WHEN 'prepare' THEN 'finance_officer' ELSE 'accountant' END,
  'none', 'view', 'view', 'view', 'none',
  CASE "finance_level" WHEN 'approve' THEN 'manage'::"access_level"
    WHEN 'prepare' THEN 'use'::"access_level" ELSE 'view'::"access_level" END,
  'none', true, false, "finance_level" = 'approve', CURRENT_TIMESTAMP
FROM "users" WHERE "role" = 'finance';

-- store_staff → Store staff for their own store.
INSERT INTO "user_access" ("user_id", "job_role", "store", "all_stores", "updated_at")
SELECT "id", 'store_staff', 'use', false, CURRENT_TIMESTAMP
FROM "users" WHERE "role" = 'store_staff';
INSERT INTO "user_stores" ("user_id", "dark_store_id")
SELECT "id", "dark_store_id" FROM "users"
WHERE "role" = 'store_staff' AND "dark_store_id" IS NOT NULL;

-- Every merchant user becomes an owner, so nobody loses access; owners can lower the others.
UPDATE "users" SET "merchant_role" = 'owner' WHERE "role" = 'merchant';
