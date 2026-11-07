-- CreateEnum
CREATE TYPE "QcStatus" AS ENUM ('OPEN', 'OVERRIDDEN', 'CONFIRMED', 'APPEALED', 'UPHELD', 'REVERSED');

-- AlterTable
ALTER TABLE "bags" ADD COLUMN     "pallet_id" UUID;

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "backhaul_of_id" UUID;

-- CreateTable
CREATE TABLE "pallets" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "origin_hub_id" UUID NOT NULL,
    "destination_hub_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'LOADING',
    "trip_id" UUID,
    "seal_no" TEXT NOT NULL DEFAULT '',
    "condition_out" TEXT NOT NULL DEFAULT '',
    "photo_out" BYTEA,
    "condition_in" TEXT NOT NULL DEFAULT '',
    "photo_in" BYTEA,
    "note_in" TEXT NOT NULL DEFAULT '',
    "sealed_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_tickets" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "shipment_id" UUID,
    "courier_id" UUID,
    "agent_id" UUID,
    "hub_id" UUID,
    "responsible_id" UUID,
    "description" TEXT NOT NULL,
    "penalty" INTEGER NOT NULL DEFAULT 0,
    "photo" BYTEA,
    "photo_mime" TEXT NOT NULL DEFAULT '',
    "status" "QcStatus" NOT NULL DEFAULT 'OPEN',
    "confirm_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "appeal_until" TIMESTAMP(3),
    "override_reason" TEXT NOT NULL DEFAULT '',
    "appeal_text" TEXT NOT NULL DEFAULT '',
    "decision_note" TEXT NOT NULL DEFAULT '',
    "created_by_id" UUID,
    "decided_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pallets_code_key" ON "pallets"("code");

-- CreateIndex
CREATE INDEX "pallets_origin_hub_id_status_idx" ON "pallets"("origin_hub_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "qc_tickets_code_key" ON "qc_tickets"("code");

-- CreateIndex
CREATE INDEX "qc_tickets_status_confirm_at_idx" ON "qc_tickets"("status", "confirm_at");

-- CreateIndex
CREATE INDEX "qc_tickets_courier_id_idx" ON "qc_tickets"("courier_id");

-- CreateIndex
CREATE INDEX "qc_tickets_agent_id_idx" ON "qc_tickets"("agent_id");

-- CreateIndex
CREATE INDEX "qc_tickets_shipment_id_idx" ON "qc_tickets"("shipment_id");

-- AddForeignKey
ALTER TABLE "bags" ADD CONSTRAINT "bags_pallet_id_fkey" FOREIGN KEY ("pallet_id") REFERENCES "pallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
