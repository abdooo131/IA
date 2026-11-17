-- Budgets planned per quarter, then by month. Each month row remembers whether it was
-- changed by hand after its quarter was split equally. Budgets entered before this were set
-- month by month, so they count as changed by hand.
ALTER TABLE "budgets" ADD COLUMN "manual" BOOLEAN NOT NULL DEFAULT false;
UPDATE "budgets" SET "manual" = true;
CREATE INDEX "budgets_month_idx" ON "budgets"("month");
