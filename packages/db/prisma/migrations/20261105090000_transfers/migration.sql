-- Transfers between locations, store to store always through the hub.

-- CreateEnum
CREATE TYPE "transfer_status" AS ENUM ('draft', 'approved', 'picking', 'in_transit', 'received', 'cancelled');

-- CreateEnum
CREATE TYPE "transfer_origin" AS ENUM ('manual', 'refill');

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "transfer_id" TEXT;

-- CreateTable
CREATE TABLE "transfers" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "from_id" TEXT NOT NULL,
    "to_id" TEXT NOT NULL,
    "final_destination_id" TEXT,
    "previous_id" TEXT,
    "status" "transfer_status" NOT NULL,
    "origin" "transfer_origin" NOT NULL DEFAULT 'manual',
    "refill_day" TEXT,
    "note" TEXT,
    "created_by_id" TEXT,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_lines" (
    "id" TEXT NOT NULL,
    "transfer_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "picked_qty" INTEGER NOT NULL DEFAULT 0,
    "received_qty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "transfer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transfers_reference_key" ON "transfers"("reference");

-- CreateIndex
CREATE INDEX "transfers_from_id_status_idx" ON "transfers"("from_id", "status");

-- CreateIndex
CREATE INDEX "transfers_to_id_status_idx" ON "transfers"("to_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_lines_transfer_id_sku_id_key" ON "transfer_lines"("transfer_id", "sku_id");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_id_fkey" FOREIGN KEY ("from_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_to_id_fkey" FOREIGN KEY ("to_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_final_destination_id_fkey" FOREIGN KEY ("final_destination_id") REFERENCES "dark_stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_previous_id_fkey" FOREIGN KEY ("previous_id") REFERENCES "transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Quantities never negative; never picked beyond what was asked, never received beyond what left.
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_picked_check" CHECK ("picked_qty" >= 0 AND "picked_qty" <= "quantity");
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_received_check" CHECK ("received_qty" >= 0 AND "received_qty" <= "picked_qty");
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_two_places_check" CHECK ("from_id" <> "to_id");
