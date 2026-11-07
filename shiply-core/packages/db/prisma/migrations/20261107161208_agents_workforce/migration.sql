-- CreateEnum
CREATE TYPE "AgentSupply" AS ENUM ('PICKUP', 'DELIVERY', 'BOTH');

-- CreateEnum
CREATE TYPE "CourierType" AS ENUM ('PICKUP', 'DELIVERY');

-- CreateEnum
CREATE TYPE "AgentDocumentKind" AS ENUM ('NATIONAL_ID', 'COMMERCIAL_REGISTER', 'TAX_CARD', 'CONTRACT', 'OTHER');

-- CreateEnum
CREATE TYPE "VehicleKind" AS ENUM ('VAN', 'BOX_TRUCK', 'PICKUP_TRUCK', 'CAR', 'MOTORCYCLE');

-- CreateEnum
CREATE TYPE "VehicleContract" AS ENUM ('FIXED', 'SPECIAL');

-- CreateEnum
CREATE TYPE "VehicleRequestReason" AS ENUM ('MERCHANT_SPECIAL', 'BREAKDOWN', 'VEHICLE_FULL', 'OTHER');

-- CreateEnum
CREATE TYPE "VehicleRequestStatus" AS ENUM ('REQUESTED', 'PROVIDED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('SCHEDULED', 'CHECKED_IN', 'LATE_NOTICE', 'NOT_COMING', 'REPLACED');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'AGENT';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "agent_id" UUID,
ADD COLUMN     "courier_type" "CourierType",
ADD COLUMN     "hub_to_hub" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pending_approval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shift_start" TEXT NOT NULL DEFAULT '09:00',
ADD COLUMN     "vehicle_id" UUID,
ADD COLUMN     "work_days" INTEGER[] DEFAULT ARRAY[0, 1, 2, 3, 4, 6]::INTEGER[],
ALTER COLUMN "email" DROP NOT NULL;

-- CreateTable
CREATE TABLE "agents" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "supplies" "AgentSupply" NOT NULL DEFAULT 'BOTH',
    "national_id_no" TEXT NOT NULL DEFAULT '',
    "commercial_register" TEXT NOT NULL DEFAULT '',
    "tax_card_no" TEXT NOT NULL DEFAULT '',
    "bank_name" TEXT NOT NULL DEFAULT '',
    "bank_account_name" TEXT NOT NULL DEFAULT '',
    "iban" TEXT NOT NULL DEFAULT '',
    "commission_bp" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_documents" (
    "id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "kind" "AgentDocumentKind" NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_areas" (
    "user_id" UUID NOT NULL,
    "area_id" UUID NOT NULL,

    CONSTRAINT "courier_areas_pkey" PRIMARY KEY ("user_id","area_id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "plate" TEXT NOT NULL,
    "kind" "VehicleKind" NOT NULL,
    "contract" "VehicleContract" NOT NULL DEFAULT 'FIXED',
    "monthly_rent" INTEGER NOT NULL DEFAULT 0,
    "capacity_parcels" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_requests" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "agent_id" UUID NOT NULL,
    "reason" "VehicleRequestReason" NOT NULL,
    "merchant_id" UUID,
    "hub_id" UUID,
    "date" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "status" "VehicleRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "vehicle_id" UUID,
    "driver_name" TEXT NOT NULL DEFAULT '',
    "driver_phone" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "requested_by_id" UUID NOT NULL,
    "provided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL,
    "courier_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "date" TEXT NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'SCHEDULED',
    "check_in_at" TIMESTAMP(3),
    "check_in_photo" BYTEA,
    "check_in_lat" DOUBLE PRECISION,
    "check_in_lng" DOUBLE PRECISION,
    "late_minutes" INTEGER,
    "alerted_at" TIMESTAMP(3),
    "answered_at" TIMESTAMP(3),
    "expected_at" TIMESTAMP(3),
    "replacement_deadline" TIMESTAMP(3),
    "replacement_overdue" BOOLEAN NOT NULL DEFAULT false,
    "replacement_shift_id" UUID,
    "replaces_shift_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'normal',
    "agent_id" UUID,
    "hub_id" UUID,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT NOT NULL DEFAULT '',
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agents_code_key" ON "agents"("code");

-- CreateIndex
CREATE INDEX "agent_documents_agent_id_idx" ON "agent_documents"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plate_key" ON "vehicles"("plate");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_requests_code_key" ON "vehicle_requests"("code");

-- CreateIndex
CREATE INDEX "vehicle_requests_agent_id_status_idx" ON "vehicle_requests"("agent_id", "status");

-- CreateIndex
CREATE INDEX "shifts_agent_id_date_idx" ON "shifts"("agent_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "shifts_courier_id_date_key" ON "shifts"("courier_id", "date");

-- CreateIndex
CREATE INDEX "alerts_status_agent_id_idx" ON "alerts"("status", "agent_id");

-- CreateIndex
CREATE INDEX "alerts_kind_entity_entity_id_idx" ON "alerts"("kind", "entity", "entity_id");

-- CreateIndex
CREATE INDEX "users_agent_id_idx" ON "users"("agent_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_documents" ADD CONSTRAINT "agent_documents_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_areas" ADD CONSTRAINT "courier_areas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_areas" ADD CONSTRAINT "courier_areas_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_requests" ADD CONSTRAINT "vehicle_requests_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_requests" ADD CONSTRAINT "vehicle_requests_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
