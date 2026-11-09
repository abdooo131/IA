-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "location";

-- CreateEnum
CREATE TYPE "location"."SiteKind" AS ENUM ('sorting_facility', 'last_mile_hub', 'dark_store');

-- CreateTable
CREATE TABLE "location"."places" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "parent_id" TEXT,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "names" TEXT[],
    "needs_parent" BOOLEAN NOT NULL DEFAULT false,
    "served" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "merged_into_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location"."taught_names" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "place_id" TEXT NOT NULL,
    "by_user_id" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "taught_names_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location"."sites" (
    "id" TEXT NOT NULL,
    "kind" "location"."SiteKind" NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "sorting_facility_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location"."delivery_zones" (
    "id" TEXT NOT NULL,
    "hub_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "delivery_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location"."area_services" (
    "place_id" TEXT NOT NULL,
    "zone_id" TEXT,
    "dark_store_id" TEXT,
    "not_served" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "area_services_pkey" PRIMARY KEY ("place_id")
);

-- CreateTable
CREATE TABLE "location"."address_decisions" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "ref_type" TEXT NOT NULL,
    "ref_id" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "phone" TEXT,
    "status" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "place_id" TEXT,
    "method" TEXT NOT NULL,
    "candidates" JSONB NOT NULL DEFAULT '[]',
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "address_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location"."phone_memory" (
    "phone" TEXT NOT NULL,
    "place_id" TEXT NOT NULL,
    "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,

    CONSTRAINT "phone_memory_pkey" PRIMARY KEY ("phone")
);

-- CreateIndex
CREATE INDEX "places_parent_id_idx" ON "location"."places"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "taught_names_normalized_place_id_key" ON "location"."taught_names"("normalized", "place_id");

-- CreateIndex
CREATE UNIQUE INDEX "sites_code_key" ON "location"."sites"("code");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_zones_code_key" ON "location"."delivery_zones"("code");

-- CreateIndex
CREATE INDEX "address_decisions_resolved_at_created_at_idx" ON "location"."address_decisions"("resolved_at", "created_at");

-- CreateIndex
CREATE INDEX "address_decisions_ref_type_ref_id_idx" ON "location"."address_decisions"("ref_type", "ref_id");

-- AddForeignKey
ALTER TABLE "location"."sites" ADD CONSTRAINT "sites_sorting_facility_id_fkey" FOREIGN KEY ("sorting_facility_id") REFERENCES "location"."sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location"."delivery_zones" ADD CONSTRAINT "delivery_zones_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "location"."sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
