-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "agents";

-- AlterTable
ALTER TABLE "parcels"."cars" ADD COLUMN     "route_id" TEXT;

-- CreateTable
CREATE TABLE "agents"."agents" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "contact_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "services" TEXT[],
    "per_delivery" INTEGER NOT NULL DEFAULT 0,
    "per_pickup" INTEGER NOT NULL DEFAULT 0,
    "per_trip" INTEGER NOT NULL DEFAULT 0,
    "per_rider_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents"."agent_managers" (
    "user_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,

    CONSTRAINT "agent_managers_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "agents"."people" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "national_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "blocked_reason" TEXT,
    "created_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents"."vehicles" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "capacity_kg" INTEGER,
    "person_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents"."documents" (
    "id" TEXT NOT NULL,
    "person_id" TEXT,
    "vehicle_id" TEXT,
    "kind" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "expires_at" DATE,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents"."requests" (
    "id" TEXT NOT NULL,
    "site_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "role" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "vehicle_type" TEXT,
    "note" TEXT,
    "agent_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "requested_by_id" TEXT NOT NULL,
    "answered_by_id" TEXT,
    "answered_agent_id" TEXT,
    "answered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents"."truck_routes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "from_site_id" TEXT NOT NULL,
    "to_site_id" TEXT NOT NULL,
    "depart_at" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "vehicle_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "truck_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents"."work_log" (
    "id" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "person_user_id" TEXT,
    "kind" TEXT NOT NULL,
    "company_key" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents"."settlements" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "from" DATE NOT NULL,
    "to" DATE NOT NULL,
    "lines" JSONB NOT NULL,
    "gross" INTEGER NOT NULL,
    "cash_held" INTEGER NOT NULL,
    "net" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "prepared_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "invoice_number" TEXT,
    "bill_ids" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agents_code_key" ON "agents"."agents"("code");

-- CreateIndex
CREATE UNIQUE INDEX "people_user_id_key" ON "agents"."people"("user_id");

-- CreateIndex
CREATE INDEX "people_agent_id_idx" ON "agents"."people"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plate_key" ON "agents"."vehicles"("plate");

-- CreateIndex
CREATE INDEX "documents_person_id_idx" ON "agents"."documents"("person_id");

-- CreateIndex
CREATE INDEX "documents_vehicle_id_idx" ON "agents"."documents"("vehicle_id");

-- CreateIndex
CREATE UNIQUE INDEX "truck_routes_code_key" ON "agents"."truck_routes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "work_log_source_key_key" ON "agents"."work_log"("source_key");

-- CreateIndex
CREATE INDEX "work_log_agent_id_at_idx" ON "agents"."work_log"("agent_id", "at");

-- CreateIndex
CREATE INDEX "settlements_agent_id_idx" ON "agents"."settlements"("agent_id");
