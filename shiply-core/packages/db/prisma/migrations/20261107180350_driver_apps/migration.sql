-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "flex_ship" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "pickups" ADD COLUMN     "auto" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "run_items" ADD COLUMN     "code_checked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "flex_paid" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION,
ADD COLUMN     "photo" BYTEA,
ADD COLUMN     "photo_mime" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "review_note" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "review_verdict" TEXT,
ADD COLUMN     "reviewed_at" TIMESTAMP(3),
ADD COLUMN     "reviewed_by_id" UUID;

-- CreateTable
CREATE TABLE "courier_pings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courier_pings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "courier_pings_user_id_at_idx" ON "courier_pings"("user_id", "at");

-- CreateIndex
CREATE INDEX "courier_pings_at_idx" ON "courier_pings"("at");
