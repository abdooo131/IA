-- Damage settlement: staff report the cause when units go to the damaged bin; admin settles
-- who pays (company for store handling and delivery, merchant otherwise).

-- CreateEnum
CREATE TYPE "damage_cause" AS ENUM ('arrived_damaged', 'store_handling', 'delivery', 'customer', 'expired');

-- CreateEnum
CREATE TYPE "damage_status" AS ENUM ('pending', 'settled');

-- AlterEnum
ALTER TYPE "ledger_account_type" ADD VALUE 'damage_expense';

-- CreateTable
CREATE TABLE "damage_reports" (
    "id" TEXT NOT NULL,
    "dark_store_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "cause" "damage_cause" NOT NULL,
    "note" TEXT,
    "rider_id" TEXT,
    "movement_id" TEXT NOT NULL,
    "status" "damage_status" NOT NULL DEFAULT 'pending',
    "reported_by_id" TEXT NOT NULL,
    "settled_by_id" TEXT,
    "settled_at" TIMESTAMP(3),
    "settle_note" TEXT,
    "compensation_piastres" INTEGER NOT NULL DEFAULT 0,
    "rider_charge_piastres" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "damage_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "damage_reports_movement_id_key" ON "damage_reports"("movement_id");

-- CreateIndex
CREATE INDEX "damage_reports_status_created_at_idx" ON "damage_reports"("status", "created_at");

-- AddForeignKey
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_movement_id_fkey" FOREIGN KEY ("movement_id") REFERENCES "stock_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_reported_by_id_fkey" FOREIGN KEY ("reported_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_settled_by_id_fkey" FOREIGN KEY ("settled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_money_check" CHECK ("compensation_piastres" >= 0 AND "rider_charge_piastres" >= 0);
