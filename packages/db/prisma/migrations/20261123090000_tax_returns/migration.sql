-- Employee identity numbers for the payroll tax and social insurance forms.
ALTER TABLE "staff_salaries" ADD COLUMN "national_id" TEXT;
ALTER TABLE "staff_salaries" ADD COLUMN "insurance_number" TEXT;
ALTER TABLE "staff_salaries" ADD CONSTRAINT "staff_salaries_national_id" CHECK ("national_id" IS NULL OR "national_id" ~ '^[0-9]{14}$');
