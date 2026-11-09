-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "merchants";

-- CreateTable
CREATE TABLE "merchants"."merchants" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "logo_url" TEXT,
    "contact_name" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "contact_email" TEXT,
    "billing_emails" TEXT[],
    "email_language" TEXT NOT NULL DEFAULT 'ar',
    "tax_number" TEXT,
    "tax_governorate" TEXT,
    "tax_city" TEXT,
    "tax_street" TEXT,
    "tax_building" TEXT,
    "bank_name" TEXT,
    "bank_account" TEXT,
    "iban" TEXT,
    "beneficiary" TEXT,
    "account_manager_id" TEXT,
    "pickup_address" TEXT,
    "pickup_place_id" TEXT,
    "pickup_decision_id" TEXT,
    "services" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reject_reason" TEXT,
    "flex_ship" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchants"."merchant_users" (
    "user_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'staff',

    CONSTRAINT "merchant_users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "merchants"."pricing_zones" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "pricing_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchants"."pricing_zone_areas" (
    "place_id" TEXT NOT NULL,
    "pricing_zone_id" TEXT NOT NULL,

    CONSTRAINT "pricing_zone_areas_pkey" PRIMARY KEY ("place_id")
);

-- CreateTable
CREATE TABLE "merchants"."contracts" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchants"."contract_versions" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "notice_days" INTEGER NOT NULL DEFAULT 30,
    "payout_schedule" TEXT NOT NULL DEFAULT 'weekly',
    "minimum_payout" INTEGER NOT NULL DEFAULT 0,
    "minimum_monthly_fee" INTEGER NOT NULL DEFAULT 0,
    "security_deposit" INTEGER NOT NULL DEFAULT 0,
    "credit_limit" INTEGER NOT NULL DEFAULT 0,
    "delivery_fee" INTEGER NOT NULL DEFAULT 0,
    "order_fixed" INTEGER NOT NULL DEFAULT 0,
    "order_percent_bp" INTEGER NOT NULL DEFAULT 0,
    "cod_percent_bp" INTEGER NOT NULL DEFAULT 0,
    "failed_delivery_fee" INTEGER NOT NULL DEFAULT 0,
    "receiving_per_unit" INTEGER NOT NULL DEFAULT 0,
    "storage_per_unit_month" INTEGER NOT NULL DEFAULT 0,
    "return_per_unit" INTEGER NOT NULL DEFAULT 0,
    "packaging_charge" INTEGER NOT NULL DEFAULT 0,
    "promise_minutes" INTEGER NOT NULL DEFAULT 60,
    "cod_fee_bp" INTEGER NOT NULL DEFAULT 0,
    "return_fee_bp" INTEGER NOT NULL DEFAULT 0,
    "open_package_fee" INTEGER NOT NULL DEFAULT 0,
    "delivery_attempts" INTEGER NOT NULL DEFAULT 3,
    "terms" TEXT,
    "internal_note" TEXT,
    "created_by_id" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejected_by_id" TEXT,
    "reject_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchants"."parcel_prices" (
    "version_id" TEXT NOT NULL,
    "pricing_zone_id" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "price" INTEGER NOT NULL,

    CONSTRAINT "parcel_prices_pkey" PRIMARY KEY ("version_id","pricing_zone_id","size")
);

-- CreateTable
CREATE TABLE "merchants"."volume_tiers" (
    "version_id" TEXT NOT NULL,
    "min_parcels" INTEGER NOT NULL,
    "discount_bp" INTEGER NOT NULL,

    CONSTRAINT "volume_tiers_pkey" PRIMARY KEY ("version_id","min_parcels")
);

-- CreateTable
CREATE TABLE "merchants"."products" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "weight_grams" INTEGER,
    "shopify_variant_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchants"."shopify_shops" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopify_shops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "merchants_code_key" ON "merchants"."merchants"("code");

-- CreateIndex
CREATE INDEX "merchants_status_idx" ON "merchants"."merchants"("status");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_zones_code_key" ON "merchants"."pricing_zones"("code");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_merchant_id_key" ON "merchants"."contracts"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_number_key" ON "merchants"."contracts"("number");

-- CreateIndex
CREATE INDEX "contract_versions_status_idx" ON "merchants"."contract_versions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "contract_versions_contract_id_version_key" ON "merchants"."contract_versions"("contract_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "products_merchant_id_sku_key" ON "merchants"."products"("merchant_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_shops_domain_key" ON "merchants"."shopify_shops"("domain");

-- AddForeignKey
ALTER TABLE "merchants"."merchant_users" ADD CONSTRAINT "merchant_users_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"."merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchants"."pricing_zone_areas" ADD CONSTRAINT "pricing_zone_areas_pricing_zone_id_fkey" FOREIGN KEY ("pricing_zone_id") REFERENCES "merchants"."pricing_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchants"."contracts" ADD CONSTRAINT "contracts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"."merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchants"."contract_versions" ADD CONSTRAINT "contract_versions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "merchants"."contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchants"."parcel_prices" ADD CONSTRAINT "parcel_prices_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "merchants"."contract_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchants"."volume_tiers" ADD CONSTRAINT "volume_tiers_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "merchants"."contract_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchants"."products" ADD CONSTRAINT "products_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"."merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchants"."shopify_shops" ADD CONSTRAINT "shopify_shops_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"."merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
