-- Sales CRM part 1 (docs/SALES.md): companies, contacts, deals with their stage history,
-- activities and lost reasons; the sales app in user_access (sales, own_deals_only).
-- Website form submissions (site_leads) stay as the raw intake: every existing lead is copied
-- into the CRM (company, contact, deal) and its follow up columns move there.

-- CreateEnum
CREATE TYPE "crm_source" AS ENUM ('website_form', 'signup', 'manual', 'referral', 'event', 'other');

-- CreateEnum
CREATE TYPE "crm_stage" AS ENUM ('new', 'contacted', 'meeting', 'proposal', 'negotiation', 'won', 'lost');

-- CreateEnum
CREATE TYPE "crm_activity_type" AS ENUM ('call', 'meeting', 'whatsapp', 'email', 'note', 'task');

-- Access: the Sales app. Owners (settings manage) get sales manage, everyone else none.
ALTER TABLE "user_access" ADD COLUMN     "own_deals_only" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sales" "access_level" NOT NULL DEFAULT 'none';
UPDATE "user_access" SET "sales" = 'manage' WHERE "settings" = 'manage';

-- CreateTable
CREATE TABLE "crm_companies" (
    "id" TEXT NOT NULL,
    "brand_name" TEXT NOT NULL,
    "website" TEXT,
    "shop_domain" TEXT,
    "category" TEXT,
    "city" TEXT,
    "expected_monthly_orders" INTEGER,
    "source" "crm_source" NOT NULL,
    "note" TEXT,
    "owner_id" TEXT,
    "merchant_id" TEXT,
    "site_lead_id" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_contacts" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "phone" TEXT,
    "phone_valid" BOOLEAN NOT NULL DEFAULT false,
    "email" TEXT,
    "whatsapp" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_deals" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "company_id" TEXT NOT NULL,
    "title" TEXT,
    "owner_id" TEXT,
    "owner_assigned_at" TIMESTAMP(3),
    "owner_assigned_by_id" TEXT,
    "auto_assigned" BOOLEAN NOT NULL DEFAULT false,
    "stage" "crm_stage" NOT NULL DEFAULT 'new',
    "expected_monthly_orders" INTEGER,
    "expected_monthly_fee_piastres" INTEGER,
    "expected_close_date" DATE,
    "lost_reason" TEXT,
    "lost_note" TEXT,
    "stage_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "won_at" TIMESTAMP(3),
    "lost_at" TIMESTAMP(3),
    "merchant_id" TEXT,
    "idempotency_key" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_deal_stage_history" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "from_stage" "crm_stage",
    "to_stage" "crm_stage" NOT NULL,
    "changed_by_id" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lost_reason" TEXT,
    "note" TEXT,

    CONSTRAINT "crm_deal_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_activities" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "deal_id" TEXT,
    "type" "crm_activity_type" NOT NULL,
    "subject" TEXT NOT NULL,
    "notes" TEXT,
    "due_at" TIMESTAMP(3),
    "done_at" TIMESTAMP(3),
    "outcome" TEXT,
    "owner_id" TEXT NOT NULL,
    "created_by_id" TEXT,
    "due_notified_at" TIMESTAMP(3),
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_lost_reasons" (
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "label_ar" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_lost_reasons_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_companies_site_lead_id_key" ON "crm_companies"("site_lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_companies_idempotency_key_key" ON "crm_companies"("idempotency_key");

-- CreateIndex
CREATE INDEX "crm_companies_owner_id_idx" ON "crm_companies"("owner_id");

-- CreateIndex
CREATE INDEX "crm_companies_merchant_id_idx" ON "crm_companies"("merchant_id");

-- CreateIndex
CREATE INDEX "crm_companies_brand_name_idx" ON "crm_companies"("brand_name");

-- CreateIndex
CREATE INDEX "crm_contacts_company_id_idx" ON "crm_contacts"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_deals_number_key" ON "crm_deals"("number");

-- CreateIndex
CREATE UNIQUE INDEX "crm_deals_idempotency_key_key" ON "crm_deals"("idempotency_key");

-- CreateIndex
CREATE INDEX "crm_deals_owner_id_stage_idx" ON "crm_deals"("owner_id", "stage");

-- CreateIndex
CREATE INDEX "crm_deals_stage_stage_changed_at_idx" ON "crm_deals"("stage", "stage_changed_at");

-- CreateIndex
CREATE INDEX "crm_deals_company_id_idx" ON "crm_deals"("company_id");

-- CreateIndex
CREATE INDEX "crm_deal_stage_history_deal_id_changed_at_idx" ON "crm_deal_stage_history"("deal_id", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "crm_activities_idempotency_key_key" ON "crm_activities"("idempotency_key");

-- CreateIndex
CREATE INDEX "crm_activities_owner_id_done_at_due_at_idx" ON "crm_activities"("owner_id", "done_at", "due_at");

-- CreateIndex
CREATE INDEX "crm_activities_deal_id_done_at_idx" ON "crm_activities"("deal_id", "done_at");

-- CreateIndex
CREATE INDEX "crm_activities_company_id_idx" ON "crm_activities"("company_id");

-- CreateIndex
CREATE INDEX "crm_activities_done_at_due_at_idx" ON "crm_activities"("done_at", "due_at");

-- AddForeignKey
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_site_lead_id_fkey" FOREIGN KEY ("site_lead_id") REFERENCES "site_leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal_stage_history" ADD CONSTRAINT "crm_deal_stage_history_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "crm_deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_deal_stage_history" ADD CONSTRAINT "crm_deal_stage_history_changed_by_id_fkey" FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "crm_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "crm_deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hard rules the database keeps as well as the code.
ALTER TABLE "crm_companies" ADD CONSTRAINT "crm_companies_orders_check" CHECK ("expected_monthly_orders" IS NULL OR "expected_monthly_orders" >= 0);
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_amounts_check" CHECK (
  ("expected_monthly_orders" IS NULL OR "expected_monthly_orders" >= 0)
  AND ("expected_monthly_fee_piastres" IS NULL OR "expected_monthly_fee_piastres" >= 0)
  AND "number" > 0);
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_lost_check" CHECK (
  ("stage" <> 'lost' OR ("lost_reason" IS NOT NULL AND "lost_at" IS NOT NULL))
  AND ("lost_reason" IS DISTINCT FROM 'other' OR length(btrim(coalesce("lost_note", ''))) > 0));
ALTER TABLE "crm_deals" ADD CONSTRAINT "crm_deals_won_check" CHECK ("stage" <> 'won' OR "won_at" IS NOT NULL);
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_open_check" CHECK ("done_at" IS NOT NULL OR "due_at" IS NOT NULL);

CREATE TRIGGER "crm_deal_stage_history_append_only" BEFORE UPDATE OR DELETE ON "crm_deal_stage_history"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_change"();

-- The lost reasons a fresh database starts with (sales managers edit the list).
INSERT INTO "crm_lost_reasons" ("code", "label_en", "label_ar", "sort_order", "updated_at") VALUES
  ('price', 'Price too high', 'السعر مرتفع', 10, CURRENT_TIMESTAMP),
  ('no_shopify', 'Not on Shopify', 'لا يستخدم Shopify', 20, CURRENT_TIMESTAMP),
  ('low_volume', 'Too few orders', 'طلبات قليلة', 30, CURRENT_TIMESTAMP),
  ('outside_zones', 'Customers outside our areas', 'العملاء خارج مناطقنا', 40, CURRENT_TIMESTAMP),
  ('competitor', 'Chose a competitor', 'اختار منافسًا', 50, CURRENT_TIMESTAMP),
  ('no_response', 'Stopped answering', 'توقف عن الرد', 60, CURRENT_TIMESTAMP),
  ('not_ready', 'Not ready yet', 'غير جاهز بعد', 70, CURRENT_TIMESTAMP);

-- Existing website leads become CRM companies, contacts and deals (in the managers' queue).
INSERT INTO "crm_companies" ("id", "brand_name", "website", "expected_monthly_orders", "source", "note", "site_lead_id", "created_at", "updated_at")
SELECT 'crmc_' || sl."id",
       coalesce(nullif(regexp_replace(lower(coalesce(sl."website", '')), '^(https?://)?(www\.)?([^/?#]*).*$', '\3'), ''), sl."name"),
       sl."website",
       CASE sl."orders_band" WHEN 'under_300' THEN 150 WHEN '300_1000' THEN 650 WHEN '1000_5000' THEN 3000 ELSE 5000 END,
       'website_form', sl."note", sl."id", sl."created_at", sl."updated_at"
FROM "site_leads" sl;

INSERT INTO "crm_contacts" ("id", "company_id", "name", "phone", "phone_valid", "created_at", "updated_at")
SELECT 'crmp_' || sl."id", 'crmc_' || sl."id", sl."name", sl."phone", sl."phone_valid", sl."created_at", sl."updated_at"
FROM "site_leads" sl;

INSERT INTO "crm_deals" ("id", "number", "company_id", "stage", "expected_monthly_orders", "lost_reason", "lost_note",
                         "stage_changed_at", "won_at", "lost_at", "created_at", "updated_at")
SELECT 'crmd_' || sl."id",
       ROW_NUMBER() OVER (ORDER BY sl."created_at", sl."id")::int,
       'crmc_' || sl."id",
       sl."status"::"crm_stage",
       CASE sl."orders_band" WHEN 'under_300' THEN 150 WHEN '300_1000' THEN 650 WHEN '1000_5000' THEN 3000 ELSE 5000 END,
       CASE WHEN sl."status" = 'lost' THEN 'other' END,
       CASE WHEN sl."status" = 'lost' THEN coalesce(nullif(btrim(sl."note"), ''), 'Marked lost on the website leads page before the CRM') END,
       CASE WHEN sl."status" = 'new' THEN sl."created_at" ELSE sl."updated_at" END,
       CASE WHEN sl."status" = 'won' THEN sl."updated_at" END,
       CASE WHEN sl."status" = 'lost' THEN sl."updated_at" END,
       sl."created_at", sl."updated_at"
FROM "site_leads" sl;

INSERT INTO "crm_deal_stage_history" ("id", "deal_id", "from_stage", "to_stage", "changed_at")
SELECT 'crmh_' || sl."id", 'crmd_' || sl."id", NULL, 'new', sl."created_at" FROM "site_leads" sl;
INSERT INTO "crm_deal_stage_history" ("id", "deal_id", "from_stage", "to_stage", "changed_by_id", "changed_at", "lost_reason")
SELECT 'crmh2_' || sl."id", 'crmd_' || sl."id", 'new', sl."status"::"crm_stage", sl."handled_by_id", sl."updated_at",
       CASE WHEN sl."status" = 'lost' THEN 'other' END
FROM "site_leads" sl WHERE sl."status" <> 'new';

-- The follow up now lives in the CRM; site_leads keeps only what the visitor sent.
ALTER TABLE "site_leads" DROP CONSTRAINT "site_leads_handled_by_id_fkey";
DROP INDEX "site_leads_status_created_at_idx";
ALTER TABLE "site_leads" DROP CONSTRAINT "site_leads_status_check";
ALTER TABLE "site_leads" DROP COLUMN "handled_by_id",
DROP COLUMN "note",
DROP COLUMN "status",
DROP COLUMN "updated_at";
