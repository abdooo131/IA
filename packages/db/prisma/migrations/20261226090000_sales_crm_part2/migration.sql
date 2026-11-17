-- Sales CRM part 2 (docs/SALES.md): proposals (PRO-000001, versions, public link, online
-- acceptance confirmed by the rep), monthly targets per rep, commission per rep and month (paid
-- through the salary run or as a direct bonus), the owner at the win on every deal, and one time
-- setup links for new merchant owners.

-- CreateEnum
CREATE TYPE "crm_proposal_status" AS ENUM ('draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'superseded');

-- CreateEnum
CREATE TYPE "crm_commission_status" AS ENUM ('draft', 'approved', 'paid');

-- AlterTable
ALTER TABLE "crm_deals" ADD COLUMN     "commission_bp" INTEGER,
ADD COLUMN     "commission_months" INTEGER,
ADD COLUMN     "won_by_id" TEXT;

-- CreateTable
CREATE TABLE "crm_proposals" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "deal_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "crm_proposal_status" NOT NULL DEFAULT 'draft',
    "order_fixed_piastres" INTEGER NOT NULL,
    "order_percent_bp" INTEGER NOT NULL,
    "cod_percent_bp" INTEGER NOT NULL,
    "failed_delivery_piastres" INTEGER NOT NULL,
    "receiving_per_unit_piastres" INTEGER NOT NULL,
    "storage_per_unit_month_piastres" INTEGER NOT NULL,
    "return_per_unit_piastres" INTEGER NOT NULL,
    "expected_monthly_orders" INTEGER,
    "average_order_piastres" INTEGER,
    "minimum_monthly_fee_piastres" INTEGER,
    "security_deposit_piastres" INTEGER,
    "credit_limit_piastres" INTEGER,
    "contract_start_date" DATE,
    "contract_months" INTEGER,
    "notice_days" INTEGER NOT NULL,
    "terms" TEXT,
    "max_discount_bp" INTEGER NOT NULL DEFAULT 0,
    "needs_approval" BOOLEAN NOT NULL DEFAULT false,
    "approval_requested_at" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "token" TEXT,
    "sent_at" TIMESTAMP(3),
    "sent_by_id" TEXT,
    "valid_until" DATE,
    "viewed_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "declined_at" TIMESTAMP(3),
    "signer_name" TEXT,
    "signer_title" TEXT,
    "decline_reason" TEXT,
    "closed_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by_id" TEXT,
    "merchant_id" TEXT,
    "created_by_id" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_proposal_tiers" (
    "id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "from_order" INTEGER NOT NULL,
    "fixed_fee_piastres" INTEGER,
    "percent_bp" INTEGER,

    CONSTRAINT "crm_proposal_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_targets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "deals_won" INTEGER NOT NULL,
    "orders" INTEGER NOT NULL,
    "fee_revenue_piastres" INTEGER NOT NULL,
    "updated_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_commissions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "status" "crm_commission_status" NOT NULL DEFAULT 'draft',
    "computed_piastres" INTEGER NOT NULL,
    "amount_piastres" INTEGER NOT NULL,
    "adjust_reason" TEXT,
    "adjusted_by_id" TEXT,
    "adjusted_at" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "paid_via" TEXT,
    "paid_entry_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_commission_lines" (
    "id" TEXT NOT NULL,
    "commission_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "month_index" INTEGER NOT NULL,
    "fees_piastres" INTEGER NOT NULL,
    "rate_bp" INTEGER NOT NULL,
    "amount_piastres" INTEGER NOT NULL,

    CONSTRAINT "crm_commission_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_setup_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_setup_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_proposals_number_key" ON "crm_proposals"("number");

-- CreateIndex
CREATE UNIQUE INDEX "crm_proposals_token_key" ON "crm_proposals"("token");

-- CreateIndex
CREATE UNIQUE INDEX "crm_proposals_idempotency_key_key" ON "crm_proposals"("idempotency_key");

-- CreateIndex
CREATE INDEX "crm_proposals_status_idx" ON "crm_proposals"("status");

-- CreateIndex
CREATE UNIQUE INDEX "crm_proposals_deal_id_version_key" ON "crm_proposals"("deal_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "crm_proposal_tiers_proposal_id_from_order_key" ON "crm_proposal_tiers"("proposal_id", "from_order");

-- CreateIndex
CREATE UNIQUE INDEX "crm_targets_user_id_month_key" ON "crm_targets"("user_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "crm_commissions_idempotency_key_key" ON "crm_commissions"("idempotency_key");

-- CreateIndex
CREATE INDEX "crm_commissions_status_month_idx" ON "crm_commissions"("status", "month");

-- CreateIndex
CREATE UNIQUE INDEX "crm_commissions_user_id_month_key" ON "crm_commissions"("user_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "crm_commission_lines_commission_id_deal_id_key" ON "crm_commission_lines"("commission_id", "deal_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_setup_tokens_token_hash_key" ON "user_setup_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "user_setup_tokens_user_id_idx" ON "user_setup_tokens"("user_id");

-- CreateIndex
CREATE INDEX "crm_deals_won_by_id_won_at_idx" ON "crm_deals"("won_by_id", "won_at");

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_won_by_id_fkey" FOREIGN KEY ("won_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "crm_deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_sent_by_id_fkey" FOREIGN KEY ("sent_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_proposal_tiers" ADD CONSTRAINT "crm_proposal_tiers_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "crm_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_targets" ADD CONSTRAINT "crm_targets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_targets" ADD CONSTRAINT "crm_targets_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_commissions" ADD CONSTRAINT "crm_commissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_commissions" ADD CONSTRAINT "crm_commissions_adjusted_by_id_fkey" FOREIGN KEY ("adjusted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_commissions" ADD CONSTRAINT "crm_commissions_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_commissions" ADD CONSTRAINT "crm_commissions_paid_entry_id_fkey" FOREIGN KEY ("paid_entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_commission_lines" ADD CONSTRAINT "crm_commission_lines_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "crm_commissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_commission_lines" ADD CONSTRAINT "crm_commission_lines_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "crm_deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_commission_lines" ADD CONSTRAINT "crm_commission_lines_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_setup_tokens" ADD CONSTRAINT "user_setup_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_setup_tokens" ADD CONSTRAINT "user_setup_tokens_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Deals already won count for the person who owned them.
UPDATE "crm_deals" SET "won_by_id" = "owner_id" WHERE "stage" = 'won' AND "won_by_id" IS NULL;

-- Hard rules the database keeps as well as the code.
ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_amounts_check" CHECK (
  "number" > 0 AND "version" > 0
  AND "order_fixed_piastres" >= 0 AND "order_percent_bp" BETWEEN 0 AND 10000
  AND "cod_percent_bp" BETWEEN 0 AND 10000 AND "failed_delivery_piastres" >= 0
  AND "receiving_per_unit_piastres" >= 0 AND "storage_per_unit_month_piastres" >= 0
  AND "return_per_unit_piastres" >= 0 AND "notice_days" >= 0
  AND ("expected_monthly_orders" IS NULL OR "expected_monthly_orders" >= 0)
  AND ("average_order_piastres" IS NULL OR "average_order_piastres" >= 0)
  AND ("minimum_monthly_fee_piastres" IS NULL OR "minimum_monthly_fee_piastres" >= 0)
  AND ("security_deposit_piastres" IS NULL OR "security_deposit_piastres" >= 0)
  AND ("credit_limit_piastres" IS NULL OR "credit_limit_piastres" >= 0)
  AND ("contract_months" IS NULL OR "contract_months" > 0));
ALTER TABLE "crm_proposals" ADD CONSTRAINT "crm_proposals_status_check" CHECK (
  ("status" = 'draft' OR ("token" IS NOT NULL AND "sent_at" IS NOT NULL) OR "status" = 'superseded')
  AND ("status" <> 'accepted' OR ("accepted_at" IS NOT NULL AND "signer_name" IS NOT NULL))
  AND ("status" <> 'declined' OR "declined_at" IS NOT NULL)
  AND ("confirmed_at" IS NULL OR ("status" = 'accepted' AND "merchant_id" IS NOT NULL))
  AND (NOT "needs_approval" OR "status" IN ('draft', 'superseded') OR "approved_at" IS NOT NULL));
ALTER TABLE "crm_proposal_tiers" ADD CONSTRAINT "crm_proposal_tiers_check" CHECK (
  "from_order" > 0 AND ("fixed_fee_piastres" IS NOT NULL OR "percent_bp" IS NOT NULL)
  AND ("fixed_fee_piastres" IS NULL OR "fixed_fee_piastres" >= 0)
  AND ("percent_bp" IS NULL OR "percent_bp" BETWEEN 0 AND 10000));
ALTER TABLE "crm_targets" ADD CONSTRAINT "crm_targets_check" CHECK (
  "month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND "deals_won" >= 0 AND "orders" >= 0
  AND "fee_revenue_piastres" >= 0);
ALTER TABLE "crm_commissions" ADD CONSTRAINT "crm_commissions_check" CHECK (
  "month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND "computed_piastres" >= 0 AND "amount_piastres" >= 0
  AND ("amount_piastres" = "computed_piastres" OR length(btrim(coalesce("adjust_reason", ''))) > 0)
  AND ("status" = 'draft' OR "approved_at" IS NOT NULL)
  AND ("status" <> 'paid' OR ("paid_at" IS NOT NULL AND "paid_via" IN ('payroll', 'bonus')))
  AND ("approved_by_id" IS NULL OR "approved_by_id" <> "user_id"));
ALTER TABLE "crm_commission_lines" ADD CONSTRAINT "crm_commission_lines_check" CHECK (
  "month_index" > 0 AND "fees_piastres" >= 0 AND "rate_bp" BETWEEN 0 AND 10000 AND "amount_piastres" >= 0);
