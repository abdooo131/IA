-- Sales commission against a monthly target (docs/SALES.md 11, agreed with the owner).
-- A won merchant counts for its rep once it has been active (a delivered order) in
-- sales.qualify_active_months distinct Cairo months, from that month on, for
-- sales.commission_months months from the win. Once a month is over the rep's counted fees are
-- compared with their fees target: at or above a target above 0 the rep earns each deal's rate
-- on all counted fees; otherwise nothing (the record is kept, closed, with the figures).

-- Nothing to pay: settled without approval.
ALTER TYPE "crm_commission_status" ADD VALUE 'closed';

-- The qualifying rule is frozen on the deal at the win, like the rate and the months.
ALTER TABLE "crm_deals" ADD COLUMN "qualify_months" INTEGER;
UPDATE "crm_deals" SET "qualify_months" = 2 WHERE "stage" = 'won' AND "won_by_id" IS NOT NULL;

ALTER TABLE "crm_commissions" ADD COLUMN "revenue_piastres" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "target_piastres" INTEGER,
ADD COLUMN "outcome" TEXT NOT NULL DEFAULT 'hit';

ALTER TABLE "crm_commission_lines" ADD COLUMN "qualified" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "active_months" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "qualified_month" TEXT;

-- No live commission exists yet: drafts are worked out again by the job under the new rule.
DELETE FROM "crm_commissions" WHERE "status"::text = 'draft';
UPDATE "crm_commissions" c SET "revenue_piastres" = COALESCE(
  (SELECT SUM(l."fees_piastres") FROM "crm_commission_lines" l WHERE l."commission_id" = c."id"), 0);

-- The new default: a merchant counts for 12 months from the win (only where the seed's old
-- default is still in place).
UPDATE "settings" SET "value" = '12'::jsonb,
  "description" = 'Months a won merchant counts for its rep, the month the deal was won counting as the first (0: no end)'
WHERE "key" = 'sales.commission_months' AND "scope" = 'global' AND "value" = '6'::jsonb;
UPDATE "settings" SET "description" = 'Commission to a rep who hit their monthly fees target, as a share of all the fees counted for them that month (basis points: 500 is 5%)'
WHERE "key" = 'sales.commission_bp' AND "scope" = 'global';

-- Comparisons use status::text: the new enum value cannot be used before this commits.
ALTER TABLE "crm_commissions" DROP CONSTRAINT "crm_commissions_check";
ALTER TABLE "crm_commissions" ADD CONSTRAINT "crm_commissions_check" CHECK (
  "month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND "computed_piastres" >= 0 AND "amount_piastres" >= 0
  AND "revenue_piastres" >= 0 AND ("target_piastres" IS NULL OR "target_piastres" >= 0)
  AND "outcome" IN ('hit', 'missed', 'no_target')
  AND ("outcome" = 'hit' OR "computed_piastres" = 0)
  AND ("amount_piastres" = "computed_piastres" OR length(btrim(coalesce("adjust_reason", ''))) > 0)
  AND ("status"::text IN ('draft', 'closed') OR "approved_at" IS NOT NULL)
  AND ("status"::text <> 'closed' OR ("amount_piastres" = 0 AND "approved_by_id" IS NULL
    AND "paid_entry_id" IS NULL))
  AND ("status"::text <> 'paid' OR ("paid_at" IS NOT NULL AND "paid_via" IN ('payroll', 'bonus')))
  AND ("approved_by_id" IS NULL OR "approved_by_id" <> "user_id"));

ALTER TABLE "crm_commission_lines" DROP CONSTRAINT "crm_commission_lines_check";
ALTER TABLE "crm_commission_lines" ADD CONSTRAINT "crm_commission_lines_check" CHECK (
  "month_index" > 0 AND "fees_piastres" >= 0 AND "rate_bp" BETWEEN 0 AND 10000
  AND "amount_piastres" >= 0 AND "active_months" >= 0
  AND ("qualified" OR "amount_piastres" = 0)
  AND ("qualified_month" IS NULL OR "qualified_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'));
