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
CREATE TYPE "NetworkAlertStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('CREATED', 'PICKED_UP', 'AT_INBOUND', 'SORTED', 'AT_OUTBOUND', 'AT_HUB', 'ON_HOLD', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'ATTEMPT_FAILED', 'DELIVERED', 'RETURNED', 'CANCELLED', 'LOST');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('FORWARD', 'RETURN');

-- CreateEnum
CREATE TYPE "ParcelSize" AS ENUM ('S', 'M', 'L', 'XL', 'XXL', 'BULKY');

-- CreateEnum
CREATE TYPE "Team" AS ENUM ('INBOUND', 'SORTING', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "PickupStatus" AS ENUM ('REQUESTED', 'ASSIGNED', 'COLLECTED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BagStatus" AS ENUM ('OPEN', 'SEALED', 'HANDED_OVER', 'IN_TRANSIT', 'RECEIVED', 'CHECKED');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('LOADING', 'IN_TRANSIT', 'ARRIVED');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('LOADING', 'OUT', 'CLOSED');

-- CreateEnum
CREATE TYPE "RunItemResult" AS ENUM ('PENDING', 'DELIVERED', 'RETURNED', 'FAILED');

-- CreateEnum
CREATE TYPE "EarningKind" AS ENUM ('DELIVERY', 'RETURN', 'PICKUP', 'BONUS', 'PENALTY', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'PAID', 'REJECTED');

-- CreateEnum
CREATE TYPE "PayInChannel" AS ENUM ('FAWRY', 'BASATA', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "PayInPurpose" AS ENUM ('CASH', 'RECHARGE');

-- CreateEnum
CREATE TYPE "CheckStatus" AS ENUM ('SUBMITTED', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PaidFrom" AS ENUM ('BANK', 'HUB_SAFE');

-- CreateEnum
CREATE TYPE "QcStatus" AS ENUM ('OPEN', 'OVERRIDDEN', 'CONFIRMED', 'APPEALED', 'UPHELD', 'REVERSED');

-- CreateEnum
CREATE TYPE "StockMoveKind" AS ENUM ('PURCHASE', 'SALE', 'CANCELLED_SALE', 'ADJUST');

-- CreateEnum
CREATE TYPE "ShopPurchaseOrderStatus" AS ENUM ('DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PackagingOrderStatus" AS ENUM ('PLACED', 'PACKED', 'OUT', 'DELIVERED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "role" ADD VALUE 'hub_staff';
ALTER TYPE "role" ADD VALUE 'courier';
ALTER TYPE "role" ADD VALUE 'agent';



-- AlterTable
ALTER TABLE "governorates" ADD COLUMN     "hub_id" TEXT,
ADD COLUMN     "lat" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "lng" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "zone_code" TEXT;

-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "area_id" TEXT,
ADD COLUMN     "code" TEXT,
ADD COLUMN     "contact_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "discount_bp" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "flex_ship" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "governorate_code" TEXT,
ADD COLUMN     "home_hub_id" TEXT,
ADD COLUMN     "logo" BYTEA,
ADD COLUMN     "logo_mime" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "pickup_address" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "agent_id" TEXT,
ADD COLUMN     "courier_type" "CourierType",
ADD COLUMN     "hub_id" TEXT,
ADD COLUMN     "hub_to_hub" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pending_approval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shift_start" TEXT NOT NULL DEFAULT '09:00',
ADD COLUMN     "team" "Team",
ADD COLUMN     "unfreeze_reason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "unfreeze_until" TIMESTAMP(3),
ADD COLUMN     "vehicle_id" TEXT,
ADD COLUMN     "work_days" INTEGER[] DEFAULT ARRAY[0, 1, 2, 3, 4, 6]::INTEGER[];

-- CreateTable
CREATE TABLE "hubs" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "is_sorting" BOOLEAN NOT NULL DEFAULT false,
    "parent_id" TEXT,
    "lat" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lng" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hubs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_zones" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "transit_days" INTEGER NOT NULL,
    "price_s" INTEGER NOT NULL,
    "price_m" INTEGER NOT NULL,
    "price_l" INTEGER NOT NULL,
    "price_xl" INTEGER NOT NULL,
    "price_xxl" INTEGER NOT NULL DEFAULT 0,
    "price_bulky" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pricing_zones_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "network_areas" (
    "id" TEXT NOT NULL,
    "governorate_code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "hub_id" TEXT,

    CONSTRAINT "network_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
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
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "kind" "AgentDocumentKind" NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_areas" (
    "user_id" TEXT NOT NULL,
    "area_id" TEXT NOT NULL,

    CONSTRAINT "courier_areas_pkey" PRIMARY KEY ("user_id","area_id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
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
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "reason" "VehicleRequestReason" NOT NULL,
    "merchant_id" TEXT,
    "hub_id" TEXT,
    "date" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "status" "VehicleRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "vehicle_id" TEXT,
    "driver_name" TEXT NOT NULL DEFAULT '',
    "driver_phone" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "requested_by_id" TEXT NOT NULL,
    "provided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_shifts" (
    "id" TEXT NOT NULL,
    "courier_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
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
    "replacement_shift_id" TEXT,
    "replaces_shift_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courier_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_alerts" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'normal',
    "agent_id" TEXT,
    "hub_id" TEXT,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "NetworkAlertStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT NOT NULL DEFAULT '',
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "network_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "tracking_number" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "merchant_ref" TEXT NOT NULL DEFAULT '',
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "governorate_code" TEXT NOT NULL,
    "area_id" TEXT,
    "size" "ParcelSize" NOT NULL DEFAULT 'M',
    "description" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "allow_open" BOOLEAN NOT NULL DEFAULT false,
    "cod_amount" INTEGER NOT NULL DEFAULT 0,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'CREATED',
    "direction" "Direction" NOT NULL DEFAULT 'FORWARD',
    "origin_hub_id" TEXT NOT NULL,
    "destination_hub_id" TEXT NOT NULL,
    "current_hub_id" TEXT,
    "pickup_id" TEXT,
    "bag_id" TEXT,
    "lane_hub_id" TEXT,
    "run_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_fail_reason" TEXT,
    "hold_reason" TEXT,
    "promised_date" TEXT,
    "route" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "search_until" TIMESTAMP(3),
    "lost_final_at" TIMESTAMP(3),
    "compensation" INTEGER NOT NULL DEFAULT 0,
    "damaged" BOOLEAN NOT NULL DEFAULT false,
    "kind" TEXT NOT NULL DEFAULT 'NORMAL',
    "linked_shipment_id" TEXT,
    "base_price" INTEGER NOT NULL DEFAULT 0,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "open_fee" INTEGER NOT NULL DEFAULT 0,
    "exchange_fee" INTEGER NOT NULL DEFAULT 0,
    "deliver_on" TEXT,
    "customer_note" TEXT NOT NULL DEFAULT '',
    "rating" INTEGER,
    "rating_comment" TEXT NOT NULL DEFAULT '',
    "shipping_fee" INTEGER NOT NULL,
    "cod_fee" INTEGER NOT NULL,
    "return_fee" INTEGER NOT NULL DEFAULT 0,
    "cod_collected" INTEGER NOT NULL DEFAULT 0,
    "payout_id" TEXT,
    "entered_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_events" (
    "id" TEXT NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "from_status" "ShipmentStatus",
    "to_status" "ShipmentStatus" NOT NULL,
    "hub_id" TEXT,
    "user_id" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pickups" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "hub_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "status" "PickupStatus" NOT NULL DEFAULT 'REQUESTED',
    "courier_id" TEXT,
    "expected_count" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "collected_at" TIMESTAMP(3),
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "received_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pickups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bags" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "origin_hub_id" TEXT NOT NULL,
    "destination_hub_id" TEXT NOT NULL,
    "status" "BagStatus" NOT NULL DEFAULT 'OPEN',
    "trip_id" TEXT,
    "sealed_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "checked_at" TIMESTAMP(3),
    "pallet_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "origin_hub_id" TEXT NOT NULL,
    "destination_hub_id" TEXT NOT NULL,
    "vehicle" TEXT NOT NULL DEFAULT '',
    "driver_name" TEXT NOT NULL DEFAULT '',
    "status" "TripStatus" NOT NULL DEFAULT 'LOADING',
    "departed_at" TIMESTAMP(3),
    "arrived_at" TIMESTAMP(3),
    "backhaul_of_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runs" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "hub_id" TEXT NOT NULL,
    "courier_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'LOADING',
    "cash_expected" INTEGER NOT NULL DEFAULT 0,
    "cash_received" INTEGER,
    "started_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "closed_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_items" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "direction" "Direction" NOT NULL,
    "result" "RunItemResult" NOT NULL DEFAULT 'PENDING',
    "fail_reason" TEXT,
    "cod_collected" INTEGER NOT NULL DEFAULT 0,
    "recipient" TEXT NOT NULL DEFAULT '',
    "back_at_hub" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMP(3),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "photo" BYTEA,
    "photo_mime" TEXT NOT NULL DEFAULT '',
    "code_checked" BOOLEAN NOT NULL DEFAULT false,
    "flex_paid" INTEGER NOT NULL DEFAULT 0,
    "review_verdict" TEXT,
    "review_note" TEXT NOT NULL DEFAULT '',
    "reviewed_by_id" TEXT,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "run_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_earnings" (
    "id" TEXT NOT NULL,
    "courier_id" TEXT NOT NULL,
    "agent_id" TEXT,
    "kind" "EarningKind" NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "amount" INTEGER NOT NULL,
    "shipment_id" TEXT,
    "date" TEXT NOT NULL,
    "available_at" TIMESTAMP(3) NOT NULL,
    "settlement_id" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courier_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "courier_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT '',
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "note" TEXT NOT NULL DEFAULT '',
    "requested_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_ins" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "courier_id" TEXT NOT NULL,
    "run_id" TEXT,
    "amount" INTEGER NOT NULL,
    "channel" "PayInChannel" NOT NULL DEFAULT 'FAWRY',
    "purpose" "PayInPurpose" NOT NULL DEFAULT 'CASH',
    "reference" TEXT NOT NULL,
    "receipt" BYTEA,
    "receipt_mime" TEXT NOT NULL DEFAULT '',
    "status" "CheckStatus" NOT NULL DEFAULT 'SUBMITTED',
    "note" TEXT NOT NULL DEFAULT '',
    "checked_by_id" TEXT,
    "checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pay_ins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safe_deposits" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "hub_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "receipt" BYTEA,
    "receipt_mime" TEXT NOT NULL DEFAULT '',
    "status" "CheckStatus" NOT NULL DEFAULT 'SUBMITTED',
    "note" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT NOT NULL,
    "checked_by_id" TEXT,
    "checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "safe_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_settlements" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "staff_pay" INTEGER NOT NULL,
    "commission_bp" INTEGER NOT NULL,
    "commission" INTEGER NOT NULL,
    "vehicle_rent" INTEGER NOT NULL,
    "special_vehicles" INTEGER NOT NULL,
    "penalties" INTEGER NOT NULL,
    "advances" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "details" JSONB NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "invoice" BYTEA,
    "invoice_name" TEXT NOT NULL DEFAULT '',
    "invoice_mime" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_advances" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "note" TEXT NOT NULL DEFAULT '',
    "requested_by_id" TEXT NOT NULL,
    "approved_by_id" TEXT,
    "settlement_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_advances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pallets" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "origin_hub_id" TEXT NOT NULL,
    "destination_hub_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'LOADING',
    "trip_id" TEXT,
    "seal_no" TEXT NOT NULL DEFAULT '',
    "condition_out" TEXT NOT NULL DEFAULT '',
    "photo_out" BYTEA,
    "condition_in" TEXT NOT NULL DEFAULT '',
    "photo_in" BYTEA,
    "note_in" TEXT NOT NULL DEFAULT '',
    "sealed_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_tickets" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "shipment_id" TEXT,
    "courier_id" TEXT,
    "agent_id" TEXT,
    "hub_id" TEXT,
    "responsible_id" TEXT,
    "description" TEXT NOT NULL,
    "penalty" INTEGER NOT NULL DEFAULT 0,
    "photo" BYTEA,
    "photo_mime" TEXT NOT NULL DEFAULT '',
    "status" "QcStatus" NOT NULL DEFAULT 'OPEN',
    "confirm_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "appeal_until" TIMESTAMP(3),
    "override_reason" TEXT NOT NULL DEFAULT '',
    "appeal_text" TEXT NOT NULL DEFAULT '',
    "decision_note" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT,
    "decided_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_tiers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "min_parcels" INTEGER NOT NULL,
    "discount_bp" INTEGER NOT NULL,

    CONSTRAINT "price_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_prices" (
    "merchant_id" TEXT NOT NULL,
    "zone_code" TEXT NOT NULL,
    "size" "ParcelSize" NOT NULL,
    "price" INTEGER NOT NULL,

    CONSTRAINT "merchant_prices_pkey" PRIMARY KEY ("merchant_id","zone_code","size")
);

-- CreateTable
CREATE TABLE "recurring_pickups" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "weekdays" INTEGER[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "last_created_for" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_pickups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "shipment_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "error" TEXT NOT NULL DEFAULT '',
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courier_pings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courier_pings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packaging_products" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    "price" INTEGER NOT NULL,
    "cost" INTEGER NOT NULL DEFAULT 0,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "min_stock" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "photo" BYTEA,
    "photo_mime" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packaging_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_moves" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "kind" "StockMoveKind" NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_cost" INTEGER NOT NULL DEFAULT 0,
    "ref" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_moves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_purchase_orders" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "status" "ShopPurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "expected_on" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "net" INTEGER NOT NULL DEFAULT 0,
    "bill_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "ordered_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shop_purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_purchase_order_lines" (
    "id" TEXT NOT NULL,
    "po_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_cost" INTEGER NOT NULL,
    "received_qty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "shop_purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packaging_orders" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "hub_id" TEXT NOT NULL,
    "status" "PackagingOrderStatus" NOT NULL DEFAULT 'PLACED',
    "payment" TEXT NOT NULL,
    "goods_total" INTEGER NOT NULL,
    "delivery_fee" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "courier_id" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "code_checked" BOOLEAN NOT NULL DEFAULT false,
    "placed_by_id" TEXT NOT NULL,
    "packed_at" TIMESTAMP(3),
    "out_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "cancel_reason" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packaging_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packaging_order_lines" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "unit_cost" INTEGER NOT NULL,

    CONSTRAINT "packaging_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_idempotency" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_idempotency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'LIVE',
    "events" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "webhook_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "response_code" INTEGER,
    "response_body" TEXT NOT NULL DEFAULT '',
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sandbox_parcels" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "tracking_number" TEXT NOT NULL,
    "merchant_ref" TEXT NOT NULL DEFAULT '',
    "input" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "shipping_fee" INTEGER NOT NULL,
    "cod_amount" INTEGER NOT NULL,
    "events" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sandbox_parcels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopify_stores" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "token_enc" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT '',
    "auto_create" BOOLEAN NOT NULL DEFAULT false,
    "default_size" TEXT NOT NULL DEFAULT 'M',
    "push_updates" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "installed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalled_at" TIMESTAMP(3),

    CONSTRAINT "shopify_stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopify_orders" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "order_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT NOT NULL DEFAULT '',
    "shipment_id" TEXT,
    "draft" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopify_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopify_tasks" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT NOT NULL DEFAULT '',
    "done_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopify_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "line_haul_links" (
    "id" TEXT NOT NULL,
    "from_id" TEXT NOT NULL,
    "to_id" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "hours" INTEGER NOT NULL DEFAULT 12,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "line_haul_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hubs_code_key" ON "hubs"("code");

-- CreateIndex
CREATE UNIQUE INDEX "network_areas_governorate_code_name_en_key" ON "network_areas"("governorate_code", "name_en");

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
CREATE INDEX "courier_shifts_agent_id_date_idx" ON "courier_shifts"("agent_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "courier_shifts_courier_id_date_key" ON "courier_shifts"("courier_id", "date");

-- CreateIndex
CREATE INDEX "network_alerts_status_agent_id_idx" ON "network_alerts"("status", "agent_id");

-- CreateIndex
CREATE INDEX "network_alerts_kind_entity_entity_id_idx" ON "network_alerts"("kind", "entity", "entity_id");

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
CREATE INDEX "courier_earnings_courier_id_date_idx" ON "courier_earnings"("courier_id", "date");

-- CreateIndex
CREATE INDEX "courier_earnings_agent_id_date_idx" ON "courier_earnings"("agent_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "courier_earnings_courier_id_kind_shipment_id_key" ON "courier_earnings"("courier_id", "kind", "shipment_id");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawals_code_key" ON "withdrawals"("code");

-- CreateIndex
CREATE INDEX "withdrawals_courier_id_idx" ON "withdrawals"("courier_id");

-- CreateIndex
CREATE UNIQUE INDEX "pay_ins_code_key" ON "pay_ins"("code");

-- CreateIndex
CREATE INDEX "pay_ins_status_idx" ON "pay_ins"("status");

-- CreateIndex
CREATE INDEX "pay_ins_run_id_idx" ON "pay_ins"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "safe_deposits_code_key" ON "safe_deposits"("code");

-- CreateIndex
CREATE INDEX "safe_deposits_hub_id_status_idx" ON "safe_deposits"("hub_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_settlements_code_key" ON "agent_settlements"("code");

-- CreateIndex
CREATE UNIQUE INDEX "agent_settlements_agent_id_month_key" ON "agent_settlements"("agent_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "agent_advances_code_key" ON "agent_advances"("code");

-- CreateIndex
CREATE INDEX "agent_advances_agent_id_idx" ON "agent_advances"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "pallets_code_key" ON "pallets"("code");

-- CreateIndex
CREATE INDEX "pallets_origin_hub_id_status_idx" ON "pallets"("origin_hub_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "qc_tickets_code_key" ON "qc_tickets"("code");

-- CreateIndex
CREATE INDEX "qc_tickets_status_confirm_at_idx" ON "qc_tickets"("status", "confirm_at");

-- CreateIndex
CREATE INDEX "qc_tickets_courier_id_idx" ON "qc_tickets"("courier_id");

-- CreateIndex
CREATE INDEX "qc_tickets_agent_id_idx" ON "qc_tickets"("agent_id");

-- CreateIndex
CREATE INDEX "qc_tickets_shipment_id_idx" ON "qc_tickets"("shipment_id");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_pickups_merchant_id_key" ON "recurring_pickups"("merchant_id");

-- CreateIndex
CREATE INDEX "otp_codes_phone_purpose_idx" ON "otp_codes"("phone", "purpose");

-- CreateIndex
CREATE INDEX "messages_status_idx" ON "messages"("status");

-- CreateIndex
CREATE INDEX "messages_shipment_id_idx" ON "messages"("shipment_id");

-- CreateIndex
CREATE INDEX "courier_pings_user_id_at_idx" ON "courier_pings"("user_id", "at");

-- CreateIndex
CREATE INDEX "courier_pings_at_idx" ON "courier_pings"("at");

-- CreateIndex
CREATE UNIQUE INDEX "packaging_products_sku_key" ON "packaging_products"("sku");

-- CreateIndex
CREATE INDEX "stock_moves_product_id_created_at_idx" ON "stock_moves"("product_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "shop_purchase_orders_code_key" ON "shop_purchase_orders"("code");

-- CreateIndex
CREATE UNIQUE INDEX "packaging_orders_code_key" ON "packaging_orders"("code");

-- CreateIndex
CREATE INDEX "packaging_orders_merchant_id_created_at_idx" ON "packaging_orders"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "packaging_orders_status_idx" ON "packaging_orders"("status");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_merchant_id_idx" ON "api_keys"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_idempotency_merchant_id_key_key" ON "api_idempotency"("merchant_id", "key");

-- CreateIndex
CREATE INDEX "webhooks_merchant_id_idx" ON "webhooks"("merchant_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_next_attempt_at_idx" ON "webhook_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_webhook_id_created_at_idx" ON "webhook_deliveries"("webhook_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sandbox_parcels_tracking_number_key" ON "sandbox_parcels"("tracking_number");

-- CreateIndex
CREATE INDEX "sandbox_parcels_merchant_id_created_at_idx" ON "sandbox_parcels"("merchant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_stores_merchant_id_key" ON "shopify_stores"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_stores_shop_key" ON "shopify_stores"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_orders_shipment_id_key" ON "shopify_orders"("shipment_id");

-- CreateIndex
CREATE INDEX "shopify_orders_store_id_created_at_idx" ON "shopify_orders"("store_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_orders_store_id_order_id_key" ON "shopify_orders"("store_id", "order_id");

-- CreateIndex
CREATE INDEX "shopify_tasks_status_next_attempt_at_idx" ON "shopify_tasks"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_tasks_shipment_id_kind_key" ON "shopify_tasks"("shipment_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "line_haul_links_from_id_to_id_key" ON "line_haul_links"("from_id", "to_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchants_code_key" ON "merchants"("code");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "hubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governorates" ADD CONSTRAINT "governorates_zone_code_fkey" FOREIGN KEY ("zone_code") REFERENCES "pricing_zones"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "governorates" ADD CONSTRAINT "governorates_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "hubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_home_hub_id_fkey" FOREIGN KEY ("home_hub_id") REFERENCES "hubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hubs" ADD CONSTRAINT "hubs_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "hubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_areas" ADD CONSTRAINT "network_areas_governorate_code_fkey" FOREIGN KEY ("governorate_code") REFERENCES "governorates"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_areas" ADD CONSTRAINT "network_areas_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "hubs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_documents" ADD CONSTRAINT "agent_documents_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_areas" ADD CONSTRAINT "courier_areas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_areas" ADD CONSTRAINT "courier_areas_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "network_areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_requests" ADD CONSTRAINT "vehicle_requests_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_requests" ADD CONSTRAINT "vehicle_requests_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_shifts" ADD CONSTRAINT "courier_shifts_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courier_shifts" ADD CONSTRAINT "courier_shifts_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "bags" ADD CONSTRAINT "bags_pallet_id_fkey" FOREIGN KEY ("pallet_id") REFERENCES "pallets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_items" ADD CONSTRAINT "run_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_items" ADD CONSTRAINT "run_items_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_moves" ADD CONSTRAINT "stock_moves_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "packaging_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_purchase_orders" ADD CONSTRAINT "shop_purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_purchase_order_lines" ADD CONSTRAINT "shop_purchase_order_lines_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "shop_purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_purchase_order_lines" ADD CONSTRAINT "shop_purchase_order_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "packaging_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packaging_order_lines" ADD CONSTRAINT "packaging_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "packaging_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packaging_order_lines" ADD CONSTRAINT "packaging_order_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "packaging_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopify_orders" ADD CONSTRAINT "shopify_orders_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "shopify_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Numbers for parcels, pickups, bags, trips, runs and the other parcel documents.
CREATE SEQUENCE IF NOT EXISTS tracking_seq START 1000;
CREATE SEQUENCE IF NOT EXISTS pickup_seq START 100;
CREATE SEQUENCE IF NOT EXISTS bag_seq START 100;
CREATE SEQUENCE IF NOT EXISTS trip_seq START 100;
CREATE SEQUENCE IF NOT EXISTS run_seq START 100;
CREATE SEQUENCE IF NOT EXISTS payout_seq START 100;
CREATE SEQUENCE IF NOT EXISTS money_seq START 1;
CREATE SEQUENCE IF NOT EXISTS invoice_seq START 1;
CREATE SEQUENCE IF NOT EXISTS control_seq START 1;
CREATE SEQUENCE IF NOT EXISTS shop_seq START 1;
CREATE SEQUENCE IF NOT EXISTS sandbox_seq START 1;

-- A parcel's history is never edited or deleted.
CREATE TRIGGER "shipment_events_append_only" BEFORE UPDATE OR DELETE ON "shipment_events"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_change"();
