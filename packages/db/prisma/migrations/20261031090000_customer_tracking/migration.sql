-- Customer tracking page (/t/<token>), the rider's latest position and the customer's rating.

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "tracking_token" TEXT;
-- Existing orders get a random token too, so old Shopify links can be answered later.
UPDATE "orders" SET "tracking_token" = substr(replace(gen_random_uuid()::text, '-', ''), 1, 24)
WHERE "tracking_token" IS NULL;
ALTER TABLE "orders" ALTER COLUMN "tracking_token" SET NOT NULL;
CREATE UNIQUE INDEX "orders_tracking_token_key" ON "orders"("tracking_token");

-- AlterTable
ALTER TABLE "riders" ADD COLUMN "last_lat" DOUBLE PRECISION,
ADD COLUMN "last_lng" DOUBLE PRECISION,
ADD COLUMN "last_location_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "order_ratings" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_ratings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "order_ratings_stars_check" CHECK ("stars" BETWEEN 1 AND 5)
);
CREATE UNIQUE INDEX "order_ratings_order_id_key" ON "order_ratings"("order_id");
CREATE INDEX "order_ratings_created_at_idx" ON "order_ratings"("created_at");
ALTER TABLE "order_ratings" ADD CONSTRAINT "order_ratings_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
