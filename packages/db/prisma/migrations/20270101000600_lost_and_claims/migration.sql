-- Lost parcels are searched for automatically and confirmed by a person; merchants claim
-- compensation for lost or damaged parcels (docs/MERGE.md, owner 2026-11-08).
CREATE SEQUENCE IF NOT EXISTS claim_seq START 1;

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "declared_value" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lost_confirmed_by_id" TEXT,
ADD COLUMN     "lost_hub_id" TEXT,
ADD COLUMN     "search_started_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "merchant_claims" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "photo" BYTEA,
    "photo_mime" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "amount" INTEGER NOT NULL DEFAULT 0,
    "decision_note" TEXT NOT NULL DEFAULT '',
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "merchant_claims_code_key" ON "merchant_claims"("code");

-- CreateIndex
CREATE INDEX "merchant_claims_merchant_id_created_at_idx" ON "merchant_claims"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "merchant_claims_status_idx" ON "merchant_claims"("status");

-- CreateIndex
CREATE INDEX "merchant_claims_shipment_id_idx" ON "merchant_claims"("shipment_id");

-- AddForeignKey
ALTER TABLE "merchant_claims" ADD CONSTRAINT "merchant_claims_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_claims" ADD CONSTRAINT "merchant_claims_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

