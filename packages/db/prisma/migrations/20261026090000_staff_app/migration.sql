-- CreateEnum
CREATE TYPE "count_status" AS ENUM ('submitted', 'approved', 'rejected', 'stale');

-- AlterEnum (rename keeps existing rows; written by hand)
ALTER TYPE "manifest_status" RENAME VALUE 'draft' TO 'expected';

-- AlterTable
ALTER TABLE "inbound_manifests" ADD COLUMN     "created_by_id" TEXT,
ADD COLUMN     "note" TEXT,
ALTER COLUMN "status" SET DEFAULT 'expected';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "merchant_id" TEXT;

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" TEXT NOT NULL,
    "dark_store_id" TEXT NOT NULL,
    "bin_id" TEXT NOT NULL,
    "status" "count_status" NOT NULL DEFAULT 'submitted',
    "submitted_by_id" TEXT NOT NULL,
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_lines" (
    "id" TEXT NOT NULL,
    "count_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "expected_qty" INTEGER NOT NULL,
    "counted_qty" INTEGER NOT NULL,

    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_counts_status_created_at_idx" ON "stock_counts"("status", "created_at");

-- CreateIndex
CREATE INDEX "stock_counts_dark_store_id_created_at_idx" ON "stock_counts"("dark_store_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_lines_count_id_sku_id_key" ON "stock_count_lines"("count_id", "sku_id");

-- CreateIndex
CREATE INDEX "notifications_merchant_id_created_at_idx" ON "notifications"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "inbound_manifests_dark_store_id_status_idx" ON "inbound_manifests"("dark_store_id", "status");

-- CreateIndex
CREATE INDEX "users_merchant_id_idx" ON "users"("merchant_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_bin_id_fkey" FOREIGN KEY ("bin_id") REFERENCES "bins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_id_fkey" FOREIGN KEY ("count_id") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_manifests" ADD CONSTRAINT "inbound_manifests_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Counts are never negative (written by hand).
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_non_negative" CHECK (
  "expected_qty" >= 0 AND "counted_qty" >= 0
);
