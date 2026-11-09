-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "parcels";

-- CreateTable
CREATE TABLE "parcels"."parcels" (
    "id" TEXT NOT NULL,
    "tracking" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "merchant_ref" TEXT,
    "customer_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address_text" TEXT NOT NULL,
    "decision_id" TEXT,
    "place_id" TEXT,
    "zone_id" TEXT,
    "hub_id" TEXT,
    "facility_id" TEXT,
    "origin_facility_id" TEXT,
    "size" TEXT NOT NULL,
    "cod_amount" INTEGER NOT NULL DEFAULT 0,
    "price" INTEGER,
    "open_package" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'created',
    "direction" TEXT NOT NULL DEFAULT 'forward',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "courier_id" TEXT,
    "run_id" TEXT,
    "bag_id" TEXT,
    "pickup_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parcels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parcels"."parcel_events" (
    "id" TEXT NOT NULL,
    "parcel_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "user_id" TEXT,
    "site_id" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parcel_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parcels"."scans" (
    "id" TEXT NOT NULL,
    "device_scan_id" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "parcel_id" TEXT,
    "bag_id" TEXT,
    "site_id" TEXT,
    "user_id" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "reason" TEXT,
    "answer" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "client_at" TIMESTAMP(3),

    CONSTRAINT "scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parcels"."pickups" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "expected_count" INTEGER,
    "courier_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "recurring_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pickups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parcels"."recurring_pickups" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "weekdays" INTEGER[],
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "recurring_pickups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parcels"."bags" (
    "id" TEXT NOT NULL,
    "seal" TEXT NOT NULL,
    "from_site_id" TEXT NOT NULL,
    "to_site_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'forward',
    "status" TEXT NOT NULL DEFAULT 'open',
    "single" BOOLEAN NOT NULL DEFAULT false,
    "car_id" TEXT,
    "count" INTEGER NOT NULL DEFAULT 0,
    "closed_by_id" TEXT,
    "received_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parcels"."cars" (
    "id" TEXT NOT NULL,
    "from_site_id" TEXT NOT NULL,
    "to_site_id" TEXT NOT NULL,
    "driver_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'loading',
    "driver_count" INTEGER,
    "departed_at" TIMESTAMP(3),
    "arrived_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parcels"."gaps" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "parcel_id" TEXT,
    "bag_id" TEXT,
    "car_id" TEXT,
    "pickup_id" TEXT,
    "last_scan_by_id" TEXT,
    "open" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "gaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parcels"."courier_zones" (
    "user_id" TEXT NOT NULL,
    "zone_id" TEXT NOT NULL,

    CONSTRAINT "courier_zones_pkey" PRIMARY KEY ("user_id","zone_id")
);

-- CreateTable
CREATE TABLE "parcels"."runs" (
    "id" TEXT NOT NULL,
    "hub_id" TEXT NOT NULL,
    "courier_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "confirmed_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parcels"."attempts" (
    "id" TEXT NOT NULL,
    "parcel_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "result" TEXT NOT NULL,
    "reason" TEXT,
    "cash_collected" INTEGER NOT NULL DEFAULT 0,
    "proof" TEXT NOT NULL DEFAULT 'none',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parcels_tracking_key" ON "parcels"."parcels"("tracking");

-- CreateIndex
CREATE INDEX "parcels_status_idx" ON "parcels"."parcels"("status");

-- CreateIndex
CREATE INDEX "parcels_merchant_id_idx" ON "parcels"."parcels"("merchant_id");

-- CreateIndex
CREATE INDEX "parcels_hub_id_status_idx" ON "parcels"."parcels"("hub_id", "status");

-- CreateIndex
CREATE INDEX "parcels_decision_id_idx" ON "parcels"."parcels"("decision_id");

-- CreateIndex
CREATE INDEX "parcel_events_parcel_id_idx" ON "parcels"."parcel_events"("parcel_id");

-- CreateIndex
CREATE UNIQUE INDEX "scans_device_scan_id_key" ON "parcels"."scans"("device_scan_id");

-- CreateIndex
CREATE INDEX "scans_parcel_id_idx" ON "parcels"."scans"("parcel_id");

-- CreateIndex
CREATE INDEX "scans_site_id_step_idx" ON "parcels"."scans"("site_id", "step");

-- CreateIndex
CREATE INDEX "pickups_date_idx" ON "parcels"."pickups"("date");

-- CreateIndex
CREATE UNIQUE INDEX "pickups_recurring_id_date_key" ON "parcels"."pickups"("recurring_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "bags_seal_key" ON "parcels"."bags"("seal");

-- CreateIndex
CREATE INDEX "gaps_open_site_id_idx" ON "parcels"."gaps"("open", "site_id");

-- CreateIndex
CREATE UNIQUE INDEX "runs_courier_id_date_key" ON "parcels"."runs"("courier_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "attempts_parcel_id_number_key" ON "parcels"."attempts"("parcel_id", "number");

-- AddForeignKey
ALTER TABLE "parcels"."parcel_events" ADD CONSTRAINT "parcel_events_parcel_id_fkey" FOREIGN KEY ("parcel_id") REFERENCES "parcels"."parcels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
