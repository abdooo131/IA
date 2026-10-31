-- Stock back to the merchant: returns reserve sellable units, staff pick them by scan and
-- the units leave the store through a new movement type, dispatch.

-- CreateEnum
CREATE TYPE "return_status" AS ENUM ('requested', 'picking', 'ready', 'collected', 'cancelled');

-- CreateEnum
CREATE TYPE "stock_source" AS ENUM ('sellable', 'damaged', 'held');

-- AlterEnum
ALTER TYPE "movement_type" ADD VALUE 'dispatch';

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "return_id" TEXT;

-- CreateTable
CREATE TABLE "merchant_returns" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "dark_store_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "status" "return_status" NOT NULL DEFAULT 'requested',
    "note" TEXT,
    "created_by_id" TEXT,
    "ready_at" TIMESTAMP(3),
    "collected_at" TIMESTAMP(3),
    "collected_by" TEXT,
    "handed_over_by_id" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_return_lines" (
    "id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "source" "stock_source" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "picked_qty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "merchant_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merchant_returns_dark_store_id_status_idx" ON "merchant_returns"("dark_store_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_returns_merchant_id_reference_key" ON "merchant_returns"("merchant_id", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_return_lines_return_id_sku_id_source_key" ON "merchant_return_lines"("return_id", "sku_id", "source");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "merchant_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_returns" ADD CONSTRAINT "merchant_returns_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_returns" ADD CONSTRAINT "merchant_returns_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_returns" ADD CONSTRAINT "merchant_returns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_returns" ADD CONSTRAINT "merchant_returns_handed_over_by_id_fkey" FOREIGN KEY ("handed_over_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_return_lines" ADD CONSTRAINT "merchant_return_lines_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "merchant_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_return_lines" ADD CONSTRAINT "merchant_return_lines_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Quantities are never negative and never picked beyond what was asked.
ALTER TABLE "merchant_return_lines" ADD CONSTRAINT "merchant_return_lines_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "merchant_return_lines" ADD CONSTRAINT "merchant_return_lines_picked_check" CHECK ("picked_qty" >= 0 AND "picked_qty" <= "quantity");
