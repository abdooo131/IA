-- Customer places (point and district) and other phones or emails kept when profiles merge.
-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "district_id" TEXT,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "located_at" TIMESTAMP(3),
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "customer_aliases" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_aliases_customer_id_idx" ON "customer_aliases"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_aliases_kind_value_key" ON "customer_aliases"("kind", "value");

-- CreateIndex
CREATE INDEX "customers_district_id_idx" ON "customers"("district_id");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "geo_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_aliases" ADD CONSTRAINT "customer_aliases_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

