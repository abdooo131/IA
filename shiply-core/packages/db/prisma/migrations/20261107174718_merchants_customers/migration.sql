-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ParcelSize" ADD VALUE 'XXL';
ALTER TYPE "ParcelSize" ADD VALUE 'BULKY';

-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "contact_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "logo" BYTEA,
ADD COLUMN     "logo_mime" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "base_price" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "customer_note" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "deliver_on" TEXT,
ADD COLUMN     "discount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "exchange_fee" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "linked_shipment_id" UUID,
ADD COLUMN     "open_fee" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rating" INTEGER,
ADD COLUMN     "rating_comment" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "merchant_owner" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "merchant_rights" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "zones" ADD COLUMN     "price_bulky" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "price_xxl" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "price_tiers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "min_parcels" INTEGER NOT NULL,
    "discount_bp" INTEGER NOT NULL,

    CONSTRAINT "price_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_prices" (
    "merchant_id" UUID NOT NULL,
    "zone_code" TEXT NOT NULL,
    "size" "ParcelSize" NOT NULL,
    "price" INTEGER NOT NULL,

    CONSTRAINT "merchant_prices_pkey" PRIMARY KEY ("merchant_id","zone_code","size")
);

-- CreateTable
CREATE TABLE "recurring_pickups" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "weekdays" INTEGER[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "last_created_for" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_pickups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "shipment_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "error" TEXT NOT NULL DEFAULT '',
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recurring_pickups_merchant_id_key" ON "recurring_pickups"("merchant_id");

-- CreateIndex
CREATE INDEX "otp_codes_phone_purpose_idx" ON "otp_codes"("phone", "purpose");

-- CreateIndex
CREATE INDEX "messages_status_idx" ON "messages"("status");

-- CreateIndex
CREATE INDEX "messages_shipment_id_idx" ON "messages"("shipment_id");

-- Existing merchant logins are their merchant's owner.
UPDATE "users" SET "merchant_owner" = true WHERE "role" = 'MERCHANT';
