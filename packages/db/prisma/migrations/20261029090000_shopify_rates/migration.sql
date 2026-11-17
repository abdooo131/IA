-- The merchant's own 60 minute delivery price; null means the option is not offered.
ALTER TABLE "merchants" ADD COLUMN "express_price_piastres" INTEGER;
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_express_price_non_negative"
  CHECK ("express_price_piastres" IS NULL OR "express_price_piastres" >= 0);

-- The carrier service that answers checkout rates for a shop.
ALTER TABLE "shopify_shops" ADD COLUMN "carrier_service_id" TEXT;

-- When the location's address in Shopify was set to the dark store's address.
ALTER TABLE "shopify_locations" ADD COLUMN "address_synced_at" TIMESTAMP(3);

-- Checkout addresses already turned into map points, so repeated rate requests stay fast.
CREATE TABLE "geocode_cache" (
    "address_key" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "geocode_cache_pkey" PRIMARY KEY ("address_key")
);
