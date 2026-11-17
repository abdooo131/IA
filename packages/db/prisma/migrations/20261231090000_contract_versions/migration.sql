-- Merchant contracts v2: the contract holds every detail of a merchant's deal in versions.
-- The earlier contract (dates, minimum, deposit, credit limit, order fee tiers) and the
-- merchant's own fee settings (scope merchant:<id>) become version 1 of each merchant's
-- contract, so past and future charges stay exactly the same.

-- CreateEnum
CREATE TYPE "contract_version_status" AS ENUM ('draft', 'active', 'superseded');

-- The earlier tables are kept aside while their rows are copied, then dropped.
ALTER TABLE "merchant_contract_tiers" DROP CONSTRAINT "merchant_contract_tiers_contract_id_fkey";
ALTER TABLE "merchant_contracts" DROP CONSTRAINT "merchant_contracts_updated_by_id_fkey";
ALTER TABLE "merchant_contracts" DROP CONSTRAINT "merchant_contracts_merchant_id_fkey";
ALTER TABLE "merchant_contracts" DROP CONSTRAINT "merchant_contracts_pkey";
ALTER TABLE "merchant_contract_tiers" DROP CONSTRAINT "merchant_contract_tiers_pkey";
DROP INDEX "merchant_contracts_merchant_id_key";
DROP INDEX "merchant_contract_tiers_contract_id_from_order_key";
ALTER TABLE "merchant_contracts" RENAME TO "legacy_merchant_contracts";
ALTER TABLE "merchant_contract_tiers" RENAME TO "legacy_merchant_contract_tiers";

-- AlterTable
ALTER TABLE "crm_proposal_tiers" ADD COLUMN     "cod_percent_bp" INTEGER,
ADD COLUMN     "failed_delivery_piastres" INTEGER,
ADD COLUMN     "receiving_per_unit_piastres" INTEGER,
ADD COLUMN     "return_per_unit_piastres" INTEGER,
ADD COLUMN     "storage_per_unit_month_piastres" INTEGER;

-- AlterTable
ALTER TABLE "crm_proposals" ADD COLUMN     "delivery_attempts" INTEGER,
ADD COLUMN     "minimum_payout_piastres" INTEGER,
ADD COLUMN     "payout_schedule" "payout_schedule",
ADD COLUMN     "promise_minutes" INTEGER;

-- CreateTable
CREATE TABLE "merchant_contracts" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_contract_versions" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "contract_version_status" NOT NULL DEFAULT 'draft',
    "effective_from" DATE,
    "order_fixed_piastres" INTEGER,
    "order_percent_bp" INTEGER,
    "cod_percent_bp" INTEGER,
    "failed_delivery_piastres" INTEGER,
    "receiving_per_unit_piastres" INTEGER,
    "storage_per_unit_month_piastres" INTEGER,
    "return_per_unit_piastres" INTEGER,
    "payout_schedule" "payout_schedule",
    "schedule_applied_at" TIMESTAMP(3),
    "minimum_payout_piastres" INTEGER,
    "minimum_monthly_fee_piastres" INTEGER,
    "security_deposit_piastres" INTEGER,
    "credit_limit_piastres" INTEGER,
    "promise_minutes" INTEGER,
    "delivery_attempts" INTEGER,
    "store_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "coverage_note" TEXT,
    "terms" TEXT,
    "internal_note" TEXT,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "notice_days" INTEGER NOT NULL,
    "source" TEXT,
    "created_by_id" TEXT,
    "activated_by_id" TEXT,
    "activated_at" TIMESTAMP(3),
    "superseded_at" TIMESTAMP(3),
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_contract_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_contract_version_tiers" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "from_order" INTEGER NOT NULL,
    "fixed_fee_piastres" INTEGER,
    "percent_bp" INTEGER,
    "cod_percent_bp" INTEGER,
    "failed_delivery_piastres" INTEGER,
    "receiving_per_unit_piastres" INTEGER,
    "storage_per_unit_month_piastres" INTEGER,
    "return_per_unit_piastres" INTEGER,

    CONSTRAINT "merchant_contract_version_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_contract_files" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "version_id" TEXT,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploaded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_contract_files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "merchant_contracts_merchant_id_key" ON "merchant_contracts"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_contracts_number_key" ON "merchant_contracts"("number");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_contract_versions_idempotency_key_key" ON "merchant_contract_versions"("idempotency_key");

-- CreateIndex
CREATE INDEX "merchant_contract_versions_contract_id_status_effective_fro_idx" ON "merchant_contract_versions"("contract_id", "status", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_contract_versions_contract_id_version_key" ON "merchant_contract_versions"("contract_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_contract_version_tiers_version_id_from_order_key" ON "merchant_contract_version_tiers"("version_id", "from_order");

-- CreateIndex
CREATE INDEX "merchant_contract_files_contract_id_idx" ON "merchant_contract_files"("contract_id");

-- AddForeignKey
ALTER TABLE "merchant_contracts" ADD CONSTRAINT "merchant_contracts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_contracts" ADD CONSTRAINT "merchant_contracts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_contract_versions" ADD CONSTRAINT "merchant_contract_versions_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "merchant_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_contract_versions" ADD CONSTRAINT "merchant_contract_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_contract_versions" ADD CONSTRAINT "merchant_contract_versions_activated_by_id_fkey" FOREIGN KEY ("activated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_contract_version_tiers" ADD CONSTRAINT "merchant_contract_version_tiers_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "merchant_contract_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_contract_files" ADD CONSTRAINT "merchant_contract_files_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "merchant_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_contract_files" ADD CONSTRAINT "merchant_contract_files_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "merchant_contract_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_contract_files" ADD CONSTRAINT "merchant_contract_files_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Money is never negative, shares stay within 100%, dates and promises make sense.
ALTER TABLE "merchant_contract_versions" ADD CONSTRAINT "merchant_contract_versions_values" CHECK (
  COALESCE("order_fixed_piastres", 0) >= 0
  AND COALESCE("order_percent_bp", 0) BETWEEN 0 AND 10000
  AND COALESCE("cod_percent_bp", 0) BETWEEN 0 AND 10000
  AND COALESCE("failed_delivery_piastres", 0) >= 0
  AND COALESCE("receiving_per_unit_piastres", 0) >= 0
  AND COALESCE("storage_per_unit_month_piastres", 0) >= 0
  AND COALESCE("return_per_unit_piastres", 0) >= 0
  AND COALESCE("minimum_payout_piastres", 0) >= 0
  AND COALESCE("minimum_monthly_fee_piastres", 0) >= 0
  AND COALESCE("security_deposit_piastres", 0) >= 0
  AND COALESCE("credit_limit_piastres", 0) >= 0
  AND COALESCE("promise_minutes", 10) > 0
  AND COALESCE("delivery_attempts", 1) >= 1
  AND "notice_days" >= 0
);
ALTER TABLE "merchant_contract_versions" ADD CONSTRAINT "merchant_contract_versions_dates" CHECK ("end_date" IS NULL OR "end_date" >= "start_date");
ALTER TABLE "merchant_contract_versions" ADD CONSTRAINT "merchant_contract_versions_active_dated" CHECK ("status" = 'draft' OR "effective_from" IS NOT NULL);
ALTER TABLE "merchant_contract_version_tiers" ADD CONSTRAINT "merchant_contract_version_tiers_values" CHECK (
  "from_order" >= 1
  AND COALESCE("fixed_fee_piastres", 0) >= 0
  AND COALESCE("percent_bp", 0) BETWEEN 0 AND 10000
  AND COALESCE("cod_percent_bp", 0) BETWEEN 0 AND 10000
  AND COALESCE("failed_delivery_piastres", 0) >= 0
  AND COALESCE("receiving_per_unit_piastres", 0) >= 0
  AND COALESCE("storage_per_unit_month_piastres", 0) >= 0
  AND COALESCE("return_per_unit_piastres", 0) >= 0
);
ALTER TABLE "merchant_contract_files" ADD CONSTRAINT "merchant_contract_files_size" CHECK ("size_bytes" > 0 AND "size_bytes" <= 5242880);

-- An activated version is never changed or removed: only its status moves on (superseded)
-- and the day its payout schedule was set on the merchant is noted. Its tiers stay as well.
CREATE FUNCTION contract_version_frozen() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'contract_version_frozen' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'draft' AND (
    (OLD.order_fixed_piastres, OLD.order_percent_bp, OLD.cod_percent_bp,
     OLD.failed_delivery_piastres, OLD.receiving_per_unit_piastres,
     OLD.storage_per_unit_month_piastres, OLD.return_per_unit_piastres, OLD.payout_schedule,
     OLD.minimum_payout_piastres, OLD.minimum_monthly_fee_piastres,
     OLD.security_deposit_piastres, OLD.credit_limit_piastres, OLD.promise_minutes,
     OLD.delivery_attempts, OLD.store_ids, OLD.coverage_note, OLD.terms, OLD.start_date,
     OLD.end_date, OLD.notice_days, OLD.effective_from, OLD.version, OLD.contract_id)
    IS DISTINCT FROM
    (NEW.order_fixed_piastres, NEW.order_percent_bp, NEW.cod_percent_bp,
     NEW.failed_delivery_piastres, NEW.receiving_per_unit_piastres,
     NEW.storage_per_unit_month_piastres, NEW.return_per_unit_piastres, NEW.payout_schedule,
     NEW.minimum_payout_piastres, NEW.minimum_monthly_fee_piastres,
     NEW.security_deposit_piastres, NEW.credit_limit_piastres, NEW.promise_minutes,
     NEW.delivery_attempts, NEW.store_ids, NEW.coverage_note, NEW.terms, NEW.start_date,
     NEW.end_date, NEW.notice_days, NEW.effective_from, NEW.version, NEW.contract_id)
    OR NEW.status = 'draft'
  ) THEN
    RAISE EXCEPTION 'contract_version_frozen' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER merchant_contract_versions_frozen
  BEFORE UPDATE OR DELETE ON "merchant_contract_versions"
  FOR EACH ROW EXECUTE FUNCTION contract_version_frozen();

CREATE FUNCTION contract_tier_frozen() RETURNS trigger AS $$
DECLARE
  v_status "contract_version_status";
BEGIN
  SELECT status INTO v_status FROM "merchant_contract_versions"
    WHERE id = COALESCE(NEW.version_id, OLD.version_id);
  -- A draft version's tiers change freely (and go with the draft when it is deleted).
  IF v_status IS NOT NULL AND v_status <> 'draft' AND TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'contract_version_frozen' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER merchant_contract_version_tiers_frozen
  BEFORE UPDATE OR DELETE ON "merchant_contract_version_tiers"
  FOR EACH ROW EXECUTE FUNCTION contract_tier_frozen();

-- contract v2 data: begin
-- Every merchant gets a contract (numbered in the order merchants were made) and version 1:
-- the earlier contract's dates, notice, minimum, deposit, credit limit, note and order fee
-- tiers, and the merchant's own fee settings as its prices (no setting: the standard price).
-- It takes effect from the merchant's first day (or the earlier contract's start if that
-- came first), so every past and future charge is priced as before. The payout schedule is
-- the merchant's current one, already set.
INSERT INTO "merchant_contracts" ("id", "merchant_id", "number", "created_at", "updated_at")
SELECT gen_random_uuid()::text, m."id",
       COALESCE((SELECT MAX("number") FROM "merchant_contracts"), 0)
         + ROW_NUMBER() OVER (ORDER BY m."created_at", m."id"),
       now(), now()
FROM "merchants" m
WHERE NOT EXISTS (SELECT 1 FROM "merchant_contracts" c WHERE c."merchant_id" = m."id");

WITH fee AS (
  SELECT substr(s."scope", 10) AS merchant_id, s."key",
         CASE
           WHEN jsonb_typeof(s."value"::jsonb) = 'number'
             AND (s."value"::jsonb #>> '{}')::numeric = trunc((s."value"::jsonb #>> '{}')::numeric)
             AND (s."value"::jsonb #>> '{}')::numeric >= 0
             AND (s."value"::jsonb #>> '{}')::numeric <=
               CASE WHEN s."key" LIKE '%\_bp' THEN 10000 ELSE 100000000 END
           THEN (s."value"::jsonb #>> '{}')::numeric::int
         END AS v
  FROM "settings" s
  WHERE s."scope" LIKE 'merchant:%'
    AND s."key" IN ('fee.order_fixed_piastres', 'fee.order_percent_bp', 'fee.cod_percent_bp',
      'fee.failed_delivery_piastres', 'fee.receiving_per_unit_piastres',
      'fee.storage_per_unit_month_piastres', 'fee.return_per_unit_piastres')
)
INSERT INTO "merchant_contract_versions" (
  "id", "contract_id", "version", "status", "effective_from",
  "order_fixed_piastres", "order_percent_bp", "cod_percent_bp", "failed_delivery_piastres",
  "receiving_per_unit_piastres", "storage_per_unit_month_piastres", "return_per_unit_piastres",
  "payout_schedule", "schedule_applied_at",
  "minimum_monthly_fee_piastres", "security_deposit_piastres", "credit_limit_piastres",
  "internal_note", "start_date", "end_date", "notice_days", "source",
  "activated_at", "created_at", "updated_at")
SELECT gen_random_uuid()::text, c."id", 1, 'active',
       LEAST((m."created_at" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo')::date,
             COALESCE(l."start_date", (m."created_at" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo')::date)),
       (SELECT f.v FROM fee f WHERE f.merchant_id = m."id" AND f."key" = 'fee.order_fixed_piastres'),
       (SELECT f.v FROM fee f WHERE f.merchant_id = m."id" AND f."key" = 'fee.order_percent_bp'),
       (SELECT f.v FROM fee f WHERE f.merchant_id = m."id" AND f."key" = 'fee.cod_percent_bp'),
       (SELECT f.v FROM fee f WHERE f.merchant_id = m."id" AND f."key" = 'fee.failed_delivery_piastres'),
       (SELECT f.v FROM fee f WHERE f.merchant_id = m."id" AND f."key" = 'fee.receiving_per_unit_piastres'),
       (SELECT f.v FROM fee f WHERE f.merchant_id = m."id" AND f."key" = 'fee.storage_per_unit_month_piastres'),
       (SELECT f.v FROM fee f WHERE f.merchant_id = m."id" AND f."key" = 'fee.return_per_unit_piastres'),
       m."payout_schedule", now(),
       l."minimum_monthly_fee_piastres", l."security_deposit_piastres", l."credit_limit_piastres",
       l."note",
       COALESCE(l."start_date", (m."created_at" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo')::date),
       l."end_date", COALESCE(l."notice_days", 30), 'migration',
       now(), now(), now()
FROM "merchant_contracts" c
JOIN "merchants" m ON m."id" = c."merchant_id"
LEFT JOIN "legacy_merchant_contracts" l ON l."merchant_id" = m."id"
WHERE NOT EXISTS (SELECT 1 FROM "merchant_contract_versions" v WHERE v."contract_id" = c."id");

INSERT INTO "merchant_contract_version_tiers" (
  "id", "version_id", "from_order", "fixed_fee_piastres", "percent_bp")
SELECT gen_random_uuid()::text, v."id", t."from_order", t."fixed_fee_piastres", t."percent_bp"
FROM "legacy_merchant_contract_tiers" t
JOIN "legacy_merchant_contracts" l ON l."id" = t."contract_id"
JOIN "merchant_contracts" c ON c."merchant_id" = l."merchant_id"
JOIN "merchant_contract_versions" v ON v."contract_id" = c."id" AND v."version" = 1
  AND v."source" = 'migration';

-- The merchant's own fee values now live only in the contract.
DELETE FROM "settings" WHERE "scope" LIKE 'merchant:%'
  AND "key" IN ('fee.order_fixed_piastres', 'fee.order_percent_bp', 'fee.cod_percent_bp',
    'fee.failed_delivery_piastres', 'fee.receiving_per_unit_piastres',
    'fee.storage_per_unit_month_piastres', 'fee.return_per_unit_piastres');
-- contract v2 data: end

DROP TABLE "legacy_merchant_contract_tiers";
DROP TABLE "legacy_merchant_contracts";
