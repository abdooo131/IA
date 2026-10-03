-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'OPERATIONS_MANAGER', 'DRIVER_MANAGER', 'DISPATCH', 'FINANCE', 'QC_AGENT', 'HUB_STAFF', 'FRANCHISE_MANAGER', 'MERCHANT_OWNER', 'MERCHANT_TEAM_MEMBER', 'PICKUP_DRIVER', 'DELIVERY_DRIVER');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('en', 'ar');

-- CreateEnum
CREATE TYPE "MerchantTier" AS ENUM ('BRONZE', 'SILVER', 'GOLD');

-- CreateEnum
CREATE TYPE "CashoutFrequency" AS ENUM ('DAILY', 'EVERY_2_DAYS', 'WEEKLY');

-- CreateEnum
CREATE TYPE "PricingZone" AS ENUM ('CAIRO_GIZA', 'ALEX_BEHIRA', 'DELTA_CANAL', 'NEAR_UPPER_EGYPT', 'FAR_UPPER_MATROUH', 'NORTH_COAST', 'SINAI_NEW_VALLEY');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('DELIVER', 'EXCHANGE', 'RETURN');

-- CreateEnum
CREATE TYPE "PackageSize" AS ENUM ('SMALL_MEDIUM', 'LARGE', 'XLARGE', 'XXL_WHITE_BAG', 'LIGHT_BULKY', 'HEAVY_BULKY');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'PENDING_PICKUP', 'PICKED_UP', 'AT_SORTING_FACILITY', 'IN_TRANSFER', 'AT_LAST_MILE_HUB', 'ASSIGNED_TO_DRIVER', 'HEADING_TO_CUSTOMER', 'RETURNS_ON_WAY', 'HEADING_TO_MERCHANT', 'AWAITING_MERCHANT_ACTION', 'REJECTED_RETURN', 'DELIVERED', 'RETURNED', 'UNSUCCESSFUL', 'ARCHIVED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('MANUAL', 'CSV', 'API', 'SHOPIFY');

-- CreateTable
CREATE TABLE "franchises" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "franchises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "language" "Language" NOT NULL DEFAULT 'en',
    "merchant_id" UUID,
    "franchise_id" UUID,
    "hub_id" UUID,
    "permissions" JSONB NOT NULL DEFAULT '[]',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchants" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "logo_url" TEXT,
    "tier" "MerchantTier" NOT NULL DEFAULT 'BRONZE',
    "vat_enabled" BOOLEAN NOT NULL DEFAULT true,
    "cashout_frequency" "CashoutFrequency" NOT NULL DEFAULT 'WEEKLY',
    "parent_merchant_id" UUID,
    "default_open_package" BOOLEAN NOT NULL DEFAULT false,
    "default_size" "PackageSize" NOT NULL DEFAULT 'SMALL_MEDIUM',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_bank_details" (
    "merchant_id" UUID NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "iban" TEXT NOT NULL,
    "last_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_bank_details_pkey" PRIMARY KEY ("merchant_id")
);

-- CreateTable
CREATE TABLE "pickup_locations" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "governorate_code" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "address_line" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "contact_phone" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pickup_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "governorates" (
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "pricing_zone" "PricingZone" NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "governorates_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" UUID NOT NULL,
    "governorate_code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "keywords" TEXT[],
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "pricing_zone" "PricingZone",

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hubs" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "governorate_code" TEXT NOT NULL,
    "address_line" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "receives_pickups" BOOLEAN NOT NULL DEFAULT false,
    "dispatches_last_mile" BOOLEAN NOT NULL DEFAULT false,
    "franchise_id" UUID,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hubs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "default_value" JSONB NOT NULL,
    "value_type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "pricing_zone_prices" (
    "id" UUID NOT NULL,
    "pickup_zone" "PricingZone" NOT NULL,
    "dest_zone" "PricingZone" NOT NULL,
    "base_price_piastres" INTEGER NOT NULL,

    CONSTRAINT "pricing_zone_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_size_adjustments" (
    "size" "PackageSize" NOT NULL,
    "add_piastres" INTEGER NOT NULL,

    CONSTRAINT "pricing_size_adjustments_pkey" PRIMARY KEY ("size")
);

-- CreateTable
CREATE TABLE "pricing_tier_adjustments" (
    "tier" "MerchantTier" NOT NULL,
    "multiplier_bp" INTEGER NOT NULL,

    CONSTRAINT "pricing_tier_adjustments_pkey" PRIMARY KEY ("tier")
);

-- CreateTable
CREATE TABLE "pricing_overrides" (
    "id" UUID NOT NULL,
    "pickup_zone" "PricingZone" NOT NULL,
    "dest_zone" "PricingZone" NOT NULL,
    "size" "PackageSize" NOT NULL,
    "order_type" "OrderType" NOT NULL,
    "tier" "MerchantTier" NOT NULL,
    "price_piastres" INTEGER NOT NULL,

    CONSTRAINT "pricing_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "tracking_number" TEXT NOT NULL,
    "merchant_reference" TEXT,
    "type" "OrderType" NOT NULL DEFAULT 'DELIVER',
    "status" "OrderStatus" NOT NULL DEFAULT 'NEW',
    "size" "PackageSize" NOT NULL DEFAULT 'SMALL_MEDIUM',
    "source" "OrderSource" NOT NULL DEFAULT 'MANUAL',
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "customer_phone_alt" TEXT,
    "governorate_code" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "address_line" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "geocode_source" TEXT,
    "pickup_location_id" UUID,
    "pickup_zone" "PricingZone" NOT NULL,
    "dest_zone" "PricingZone" NOT NULL,
    "destination_hub_id" UUID,
    "needs_manual_hub" BOOLEAN NOT NULL DEFAULT false,
    "cod_amount" INTEGER NOT NULL DEFAULT 0,
    "allow_open_package" BOOLEAN NOT NULL DEFAULT false,
    "items_description" TEXT,
    "return_items_description" TEXT,
    "notes" TEXT,
    "shipping_fee" INTEGER NOT NULL,
    "cod_fee" INTEGER NOT NULL,
    "open_package_fee" INTEGER NOT NULL,
    "vat_amount" INTEGER NOT NULL,
    "total_fees" INTEGER NOT NULL,
    "failed_delivery_fee" INTEGER NOT NULL,
    "pricing_snapshot" JSONB NOT NULL,
    "print_count" INTEGER NOT NULL DEFAULT 0,
    "label_printed_at" TIMESTAMP(3),
    "import_batch_id" UUID,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" BIGSERIAL NOT NULL,
    "order_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "from_status" "OrderStatus",
    "to_status" "OrderStatus",
    "note" TEXT,
    "actor_id" UUID,
    "actor_role" TEXT,
    "hub_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" UUID,
    "actor_role" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "merchant_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "total_rows" INTEGER NOT NULL,
    "success_rows" INTEGER NOT NULL,
    "error_rows" INTEGER NOT NULL,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_merchant_id_idx" ON "users"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_code_key" ON "merchants"("code");

-- CreateIndex
CREATE INDEX "pickup_locations_merchant_id_idx" ON "pickup_locations"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "hubs_code_key" ON "hubs"("code");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_zone_prices_pickup_zone_dest_zone_key" ON "pricing_zone_prices"("pickup_zone", "dest_zone");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_overrides_pickup_zone_dest_zone_size_order_type_tie_key" ON "pricing_overrides"("pickup_zone", "dest_zone", "size", "order_type", "tier");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tracking_number_key" ON "orders"("tracking_number");

-- CreateIndex
CREATE INDEX "orders_merchant_id_status_idx" ON "orders"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "orders_merchant_id_created_at_idx" ON "orders"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_customer_phone_idx" ON "orders"("customer_phone");

-- CreateIndex
CREATE INDEX "order_events_order_id_created_at_idx" ON "order_events"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE INDEX "import_batches_merchant_id_idx" ON "import_batches"("merchant_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "hubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_parent_merchant_id_fkey" FOREIGN KEY ("parent_merchant_id") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_bank_details" ADD CONSTRAINT "merchant_bank_details_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_locations" ADD CONSTRAINT "pickup_locations_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_locations" ADD CONSTRAINT "pickup_locations_governorate_code_fkey" FOREIGN KEY ("governorate_code") REFERENCES "governorates"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_governorate_code_fkey" FOREIGN KEY ("governorate_code") REFERENCES "governorates"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hubs" ADD CONSTRAINT "hubs_governorate_code_fkey" FOREIGN KEY ("governorate_code") REFERENCES "governorates"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hubs" ADD CONSTRAINT "hubs_franchise_id_fkey" FOREIGN KEY ("franchise_id") REFERENCES "franchises"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_governorate_code_fkey" FOREIGN KEY ("governorate_code") REFERENCES "governorates"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_pickup_location_id_fkey" FOREIGN KEY ("pickup_location_id") REFERENCES "pickup_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_destination_hub_id_fkey" FOREIGN KEY ("destination_hub_id") REFERENCES "hubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
