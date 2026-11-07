-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'HUB_STAFF', 'COURIER', 'MERCHANT');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('CREATED', 'PICKED_UP', 'AT_HUB', 'ON_HOLD', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'ATTEMPT_FAILED', 'DELIVERED', 'RETURNED', 'CANCELLED', 'LOST');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('FORWARD', 'RETURN');

-- CreateEnum
CREATE TYPE "ParcelSize" AS ENUM ('S', 'M', 'L', 'XL');

-- CreateEnum
CREATE TYPE "PickupStatus" AS ENUM ('REQUESTED', 'ASSIGNED', 'COLLECTED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BagStatus" AS ENUM ('OPEN', 'SEALED', 'IN_TRANSIT', 'RECEIVED');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('LOADING', 'IN_TRANSIT', 'ARRIVED');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('LOADING', 'OUT', 'CLOSED');

-- CreateEnum
CREATE TYPE "RunItemResult" AS ENUM ('PENDING', 'DELIVERED', 'RETURNED', 'FAILED');

-- CreateTable
CREATE TABLE "hubs" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "is_sorting" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hubs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zones" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "transit_days" INTEGER NOT NULL,
    "price_s" INTEGER NOT NULL,
    "price_m" INTEGER NOT NULL,
    "price_l" INTEGER NOT NULL,
    "price_xl" INTEGER NOT NULL,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "governorates" (
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "zone_code" TEXT NOT NULL,
    "hub_id" UUID,

    CONSTRAINT "governorates_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" UUID NOT NULL,
    "governorate_code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "hub_id" UUID,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "hub_id" UUID,
    "merchant_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchants" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "pickup_address" TEXT NOT NULL,
    "governorate_code" TEXT NOT NULL,
    "area_id" UUID,
    "home_hub_id" UUID NOT NULL,
    "discount_bp" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "tracking_number" TEXT NOT NULL,
    "merchant_id" UUID NOT NULL,
    "merchant_ref" TEXT NOT NULL DEFAULT '',
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "governorate_code" TEXT NOT NULL,
    "area_id" UUID,
    "size" "ParcelSize" NOT NULL DEFAULT 'M',
    "description" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "allow_open" BOOLEAN NOT NULL DEFAULT false,
    "cod_amount" INTEGER NOT NULL DEFAULT 0,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'CREATED',
    "direction" "Direction" NOT NULL DEFAULT 'FORWARD',
    "origin_hub_id" UUID NOT NULL,
    "destination_hub_id" UUID NOT NULL,
    "current_hub_id" UUID,
    "pickup_id" UUID,
    "bag_id" UUID,
    "run_id" UUID,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_fail_reason" TEXT,
    "hold_reason" TEXT,
    "promised_date" TEXT,
    "shipping_fee" INTEGER NOT NULL,
    "cod_fee" INTEGER NOT NULL,
    "return_fee" INTEGER NOT NULL DEFAULT 0,
    "cod_collected" INTEGER NOT NULL DEFAULT 0,
    "payout_id" UUID,
    "entered_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_events" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "from_status" "ShipmentStatus",
    "to_status" "ShipmentStatus" NOT NULL,
    "hub_id" UUID,
    "user_id" UUID,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pickups" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "merchant_id" UUID NOT NULL,
    "hub_id" UUID NOT NULL,
    "date" TEXT NOT NULL,
    "status" "PickupStatus" NOT NULL DEFAULT 'REQUESTED',
    "courier_id" UUID,
    "expected_count" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "collected_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pickups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bags" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "origin_hub_id" UUID NOT NULL,
    "destination_hub_id" UUID NOT NULL,
    "status" "BagStatus" NOT NULL DEFAULT 'OPEN',
    "trip_id" UUID,
    "sealed_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "origin_hub_id" UUID NOT NULL,
    "destination_hub_id" UUID NOT NULL,
    "vehicle" TEXT NOT NULL DEFAULT '',
    "driver_name" TEXT NOT NULL DEFAULT '',
    "status" "TripStatus" NOT NULL DEFAULT 'LOADING',
    "departed_at" TIMESTAMP(3),
    "arrived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runs" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "hub_id" UUID NOT NULL,
    "courier_id" UUID NOT NULL,
    "date" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'LOADING',
    "cash_expected" INTEGER NOT NULL DEFAULT 0,
    "cash_received" INTEGER,
    "started_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "closed_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_items" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "direction" "Direction" NOT NULL,
    "result" "RunItemResult" NOT NULL DEFAULT 'PENDING',
    "fail_reason" TEXT,
    "cod_collected" INTEGER NOT NULL DEFAULT 0,
    "recipient" TEXT NOT NULL DEFAULT '',
    "back_at_hub" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "run_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "merchant_id" UUID NOT NULL,
    "cod_total" INTEGER NOT NULL,
    "fees_total" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hubs_code_key" ON "hubs"("code");

-- CreateIndex
CREATE UNIQUE INDEX "areas_governorate_code_name_en_key" ON "areas"("governorate_code", "name_en");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_code_key" ON "merchants"("code");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_tracking_number_key" ON "shipments"("tracking_number");

-- CreateIndex
CREATE INDEX "shipments_merchant_id_created_at_idx" ON "shipments"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "shipments_status_current_hub_id_idx" ON "shipments"("status", "current_hub_id");

-- CreateIndex
CREATE INDEX "shipments_bag_id_idx" ON "shipments"("bag_id");

-- CreateIndex
CREATE INDEX "shipments_run_id_idx" ON "shipments"("run_id");

-- CreateIndex
CREATE INDEX "shipments_pickup_id_idx" ON "shipments"("pickup_id");

-- CreateIndex
CREATE INDEX "shipment_events_shipment_id_created_at_idx" ON "shipment_events"("shipment_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "pickups_code_key" ON "pickups"("code");

-- CreateIndex
CREATE INDEX "pickups_hub_id_date_idx" ON "pickups"("hub_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "bags_code_key" ON "bags"("code");

-- CreateIndex
CREATE INDEX "bags_origin_hub_id_status_idx" ON "bags"("origin_hub_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "trips_code_key" ON "trips"("code");

-- CreateIndex
CREATE UNIQUE INDEX "runs_code_key" ON "runs"("code");

-- CreateIndex
CREATE INDEX "runs_courier_id_status_idx" ON "runs"("courier_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "run_items_run_id_shipment_id_key" ON "run_items"("run_id", "shipment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_code_key" ON "payouts"("code");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_idx" ON "audit_log"("entity", "entity_id");

-- AddForeignKey
ALTER TABLE "governorates" ADD CONSTRAINT "governorates_zone_code_fkey" FOREIGN KEY ("zone_code") REFERENCES "zones"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governorates" ADD CONSTRAINT "governorates_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "hubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_governorate_code_fkey" FOREIGN KEY ("governorate_code") REFERENCES "governorates"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "hubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "hubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_home_hub_id_fkey" FOREIGN KEY ("home_hub_id") REFERENCES "hubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickups" ADD CONSTRAINT "pickups_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bags" ADD CONSTRAINT "bags_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_items" ADD CONSTRAINT "run_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_items" ADD CONSTRAINT "run_items_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sequences for human readable codes.
CREATE SEQUENCE tracking_seq START 1000;
CREATE SEQUENCE pickup_seq START 100;
CREATE SEQUENCE bag_seq START 100;
CREATE SEQUENCE trip_seq START 100;
CREATE SEQUENCE run_seq START 100;
CREATE SEQUENCE payout_seq START 100;

-- Money is never negative.
ALTER TABLE shipments ADD CONSTRAINT shipments_money_ok CHECK (
  cod_amount >= 0 AND shipping_fee >= 0 AND cod_fee >= 0 AND return_fee >= 0 AND cod_collected >= 0
);
ALTER TABLE shipments ADD CONSTRAINT shipments_attempts_ok CHECK (attempts >= 0);
ALTER TABLE runs ADD CONSTRAINT runs_cash_ok CHECK (cash_expected >= 0 AND (cash_received IS NULL OR cash_received >= 0));
ALTER TABLE zones ADD CONSTRAINT zones_prices_ok CHECK (price_s >= 0 AND price_m >= 0 AND price_l >= 0 AND price_xl >= 0 AND transit_days >= 0);

-- A parcel is in at most one place: a bag, a run or a pickup vehicle.
ALTER TABLE shipments ADD CONSTRAINT shipments_one_place CHECK (
  (CASE WHEN bag_id IS NULL THEN 0 ELSE 1 END) + (CASE WHEN run_id IS NULL THEN 0 ELSE 1 END) <= 1
);

-- History tables are append only.
CREATE FUNCTION reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append only', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER shipment_events_append_only BEFORE UPDATE OR DELETE ON shipment_events
  FOR EACH ROW EXECUTE FUNCTION reject_change();
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_change();
