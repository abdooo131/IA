-- Rider supply offices: a supplier marked as a rider office earns a commission (basis points)
-- on the pay per delivered order of the riders linked to it (employees.employment outsourced
-- with staffing_supplier_id). The commission is accrued at each delivery and billed once a
-- month (bills.office_month, one bill per office and month).

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN "is_rider_office" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "commission_bp" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_commission_bp_check"
  CHECK ("commission_bp" >= 0 AND "commission_bp" <= 10000);

-- AlterTable
ALTER TABLE "bills" ADD COLUMN "office_month" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "bills_supplier_id_office_month_key" ON "bills"("supplier_id", "office_month");
