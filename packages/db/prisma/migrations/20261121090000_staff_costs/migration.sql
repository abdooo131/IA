-- Employees on our payroll and people hired through an outsourcing company.

CREATE TYPE "employment_type" AS ENUM ('employee', 'outsourced');
ALTER TABLE "users" ADD COLUMN "employment" "employment_type" NOT NULL DEFAULT 'employee';
-- The outsourcing company (a supplier) an outsourced person is hired through
ALTER TABLE "users" ADD COLUMN "staffing_supplier_id" TEXT;
ALTER TABLE "users" ADD CONSTRAINT "users_staffing_supplier_id_fkey" FOREIGN KEY ("staffing_supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_outsourced_supplier" CHECK (("employment" = 'outsourced') = ("staffing_supplier_id" IS NOT NULL));

-- The wage social insurance is counted on (the contract's insured wage); empty means the salary
ALTER TABLE "staff_salaries" ADD COLUMN "insured_wage_piastres" INTEGER;

-- A bill may be for one person (an outsourced worker's month); several people share an invoice number
ALTER TABLE "bills" ADD COLUMN "user_id" TEXT;
ALTER TABLE "bills" ADD CONSTRAINT "bills_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
DROP INDEX "bills_supplier_id_reference_key";
CREATE UNIQUE INDEX "bills_supplier_reference_user_key" ON "bills"("supplier_id", "reference", "user_id") NULLS NOT DISTINCT;
CREATE INDEX "bills_user_id_idx" ON "bills"("user_id");
