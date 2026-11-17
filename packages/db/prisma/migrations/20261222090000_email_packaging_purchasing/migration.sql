-- Email outbox to merchants, packaging stock (our consumables) and purchase orders.

-- CreateEnum
CREATE TYPE "email_status" AS ENUM ('pending', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "packaging_movement_type" AS ENUM ('receive', 'consume', 'adjust', 'count');

-- CreateEnum
CREATE TYPE "purchase_order_status" AS ENUM ('requested', 'approved', 'ordered', 'received', 'billed', 'closed', 'rejected', 'cancelled');

-- AlterTable
ALTER TABLE "bills" ADD COLUMN     "purchase_order_id" TEXT;

-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "billing_emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "email_language" TEXT NOT NULL DEFAULT 'ar',
ADD COLUMN     "email_opt_outs" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "email_outbox" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "merchant_id" TEXT,
    "to_emails" TEXT[],
    "language" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "attachments" JSONB,
    "idempotency_key" TEXT NOT NULL,
    "status" "email_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packaging_items" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'piece',
    "unit_cost_piastres" INTEGER NOT NULL DEFAULT 0,
    "is_box" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "packaging_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packaging_levels" (
    "id" TEXT NOT NULL,
    "dark_store_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "on_hand" INTEGER NOT NULL DEFAULT 0,
    "value_piastres" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "packaging_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packaging_movements" (
    "id" TEXT NOT NULL,
    "dark_store_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "type" "packaging_movement_type" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "value_piastres" INTEGER NOT NULL,
    "order_id" TEXT,
    "purchase_order_id" TEXT,
    "entry_id" TEXT,
    "reason" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packaging_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packaging_recipes" (
    "id" TEXT NOT NULL,
    "dark_store_id" TEXT,
    "merchant_id" TEXT,
    "item_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "packaging_recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "dark_store_id" TEXT,
    "status" "purchase_order_status" NOT NULL DEFAULT 'requested',
    "total_piastres" INTEGER NOT NULL,
    "note" TEXT,
    "quote_photo_id" TEXT,
    "requested_by_id" TEXT NOT NULL,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "ordered_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "packaging_item_id" TEXT,
    "expense_account_id" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_piastres" INTEGER NOT NULL,
    "received_qty" INTEGER NOT NULL DEFAULT 0,
    "billed_qty" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_outbox_idempotency_key_key" ON "email_outbox"("idempotency_key");

-- CreateIndex
CREATE INDEX "email_outbox_status_next_attempt_at_idx" ON "email_outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "email_outbox_merchant_id_created_at_idx" ON "email_outbox"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "email_outbox_created_at_idx" ON "email_outbox"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "packaging_items_code_key" ON "packaging_items"("code");

-- CreateIndex
CREATE UNIQUE INDEX "packaging_levels_dark_store_id_item_id_key" ON "packaging_levels"("dark_store_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "packaging_movements_idempotency_key_key" ON "packaging_movements"("idempotency_key");

-- CreateIndex
CREATE INDEX "packaging_movements_dark_store_id_item_id_created_at_idx" ON "packaging_movements"("dark_store_id", "item_id", "created_at");

-- CreateIndex
CREATE INDEX "packaging_movements_order_id_idx" ON "packaging_movements"("order_id");

-- CreateIndex
CREATE INDEX "packaging_recipes_dark_store_id_merchant_id_idx" ON "packaging_recipes"("dark_store_id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_number_key" ON "purchase_orders"("number");

-- CreateIndex
CREATE INDEX "purchase_orders_status_created_at_idx" ON "purchase_orders"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_lines_purchase_order_id_line_no_key" ON "purchase_order_lines"("purchase_order_id", "line_no");

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packaging_levels" ADD CONSTRAINT "packaging_levels_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packaging_levels" ADD CONSTRAINT "packaging_levels_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "packaging_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packaging_movements" ADD CONSTRAINT "packaging_movements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "packaging_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packaging_recipes" ADD CONSTRAINT "packaging_recipes_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "packaging_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_packaging_item_id_fkey" FOREIGN KEY ("packaging_item_id") REFERENCES "packaging_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_expense_account_id_fkey" FOREIGN KEY ("expense_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CreateTable
CREATE TABLE "purchase_order_receipts" (
    "id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "value_piastres" INTEGER NOT NULL,
    "entry_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_receipts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "purchase_order_receipts_idempotency_key_key" ON "purchase_order_receipts"("idempotency_key");
CREATE INDEX "purchase_order_receipts_purchase_order_id_idx" ON "purchase_order_receipts"("purchase_order_id");
ALTER TABLE "purchase_order_receipts" ADD CONSTRAINT "purchase_order_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rules the database keeps by itself
ALTER TABLE "packaging_levels" ADD CONSTRAINT "packaging_levels_not_negative"
  CHECK ("on_hand" >= 0 AND "value_piastres" >= 0 AND ("on_hand" > 0 OR "value_piastres" = 0));
ALTER TABLE "packaging_items" ADD CONSTRAINT "packaging_items_cost_not_negative" CHECK ("unit_cost_piastres" >= 0);
ALTER TABLE "packaging_recipes" ADD CONSTRAINT "packaging_recipes_quantity_positive" CHECK ("quantity" > 0);
CREATE UNIQUE INDEX "packaging_recipes_scope_item_key" ON "packaging_recipes"
  (COALESCE("dark_store_id", ''), COALESCE("merchant_id", ''), "item_id");
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_total_not_negative" CHECK ("total_piastres" >= 0);
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_quantities"
  CHECK ("quantity" > 0 AND "unit_price_piastres" >= 0 AND "received_qty" >= 0
    AND "received_qty" <= "quantity" AND "billed_qty" >= 0 AND "billed_qty" <= "received_qty");
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_kind"
  CHECK (("packaging_item_id" IS NULL) <> ("expense_account_id" IS NULL));
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_has_recipient" CHECK (cardinality("to_emails") > 0);

-- Packaging movements are append only, like stock movements
CREATE TRIGGER "packaging_movements_append_only" BEFORE UPDATE OR DELETE ON "packaging_movements"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_change"();
