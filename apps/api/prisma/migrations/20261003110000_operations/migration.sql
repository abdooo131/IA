-- CreateEnum
CREATE TYPE "DriverType" AS ENUM ('PICKUP', 'DELIVERY');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('OPEN', 'IN_TRANSIT', 'RECEIVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JournalType" ADD VALUE 'DRIVER_HANDOVER';
ALTER TYPE "JournalType" ADD VALUE 'EXPENSE';
ALTER TYPE "JournalType" ADD VALUE 'MANUAL';
ALTER TYPE "JournalType" ADD VALUE 'OPENING_BALANCE';

-- DropForeignKey

-- AlterTable
ALTER TABLE "ledger_entries" ADD COLUMN     "driver_id" UUID;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cash_handover_id" UUID,
ADD COLUMN     "current_hub_id" UUID,
ADD COLUMN     "delivery_driver_id" UUID,
ADD COLUMN     "is_returning" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_failed_reason" TEXT,
ADD COLUMN     "pickup_driver_id" UUID;

-- CreateTable
CREATE TABLE "drivers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "DriverType" NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "national_id" TEXT,
    "vehicle" TEXT NOT NULL DEFAULT 'MOTORCYCLE',
    "hub_id" UUID,
    "franchise_id" UUID,
    "status" "DriverStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "origin_hub_id" UUID NOT NULL,
    "destination_hub_id" UUID NOT NULL,
    "driver_id" UUID,
    "vehicle" TEXT,
    "status" "TransferStatus" NOT NULL DEFAULT 'OPEN',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_items" (
    "id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "scanned_out_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scanned_in_at" TIMESTAMP(3),

    CONSTRAINT "transfer_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_handovers" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "hub_id" UUID,
    "expected_amount" INTEGER NOT NULL,
    "received_amount" INTEGER NOT NULL,
    "difference" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "journal_id" BIGINT,
    "received_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "resolution" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "drivers_user_id_key" ON "drivers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_code_key" ON "transfers"("code");

-- CreateIndex
CREATE INDEX "transfers_status_idx" ON "transfers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_items_transfer_id_order_id_key" ON "transfer_items"("transfer_id", "order_id");

-- CreateIndex
CREATE INDEX "cash_handovers_driver_id_idx" ON "cash_handovers"("driver_id");

-- CreateIndex
CREATE INDEX "alerts_status_created_at_idx" ON "alerts"("status", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_driver_id_account_code_idx" ON "ledger_entries"("driver_id", "account_code");

-- CreateIndex
CREATE INDEX "orders_status_current_hub_id_idx" ON "orders"("status", "current_hub_id");

-- CreateIndex
CREATE INDEX "orders_delivery_driver_id_status_idx" ON "orders"("delivery_driver_id", "status");

-- CreateIndex
CREATE INDEX "orders_pickup_driver_id_status_idx" ON "orders"("pickup_driver_id", "status");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_pickup_driver_id_fkey" FOREIGN KEY ("pickup_driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_driver_id_fkey" FOREIGN KEY ("delivery_driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_current_hub_id_fkey" FOREIGN KEY ("current_hub_id") REFERENCES "hubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_cash_handover_id_fkey" FOREIGN KEY ("cash_handover_id") REFERENCES "cash_handovers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "hubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_origin_hub_id_fkey" FOREIGN KEY ("origin_hub_id") REFERENCES "hubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_destination_hub_id_fkey" FOREIGN KEY ("destination_hub_id") REFERENCES "hubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_items" ADD CONSTRAINT "transfer_items_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_items" ADD CONSTRAINT "transfer_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_handovers" ADD CONSTRAINT "cash_handovers_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row level security: drivers, transfers, handovers and alerts are company operations data (staff only).
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_only ON drivers USING (app_bypass_rls()) WITH CHECK (app_bypass_rls());
ALTER TABLE transfers ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_only ON transfers USING (app_bypass_rls()) WITH CHECK (app_bypass_rls());
ALTER TABLE transfer_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_only ON transfer_items USING (app_bypass_rls()) WITH CHECK (app_bypass_rls());
ALTER TABLE cash_handovers ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_only ON cash_handovers USING (app_bypass_rls()) WITH CHECK (app_bypass_rls());
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_only ON alerts USING (app_bypass_rls()) WITH CHECK (app_bypass_rls());
CREATE INDEX transfer_items_order_idx ON transfer_items(order_id);
