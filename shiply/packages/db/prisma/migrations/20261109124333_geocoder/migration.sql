-- AlterTable
ALTER TABLE "location"."address_decisions" ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "location"."geocode_cache" (
    "normalized" TEXT NOT NULL,
    "answer" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geocode_cache_pkey" PRIMARY KEY ("normalized")
);

-- CreateIndex
CREATE INDEX "geocode_cache_at_idx" ON "location"."geocode_cache"("at");
