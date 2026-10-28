-- Chart of accounts: every ledger account gets a code from its group's sequence
-- (1000 assets, 2000 liabilities, 3000 equity, 4000 income, 5000 expenses), a category and,
-- for company accounts, a name. Entries, payouts and cash handovers get serial numbers.

CREATE TYPE "account_category" AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');

ALTER TABLE "ledger_accounts"
  ADD COLUMN "code" TEXT,
  ADD COLUMN "category" "account_category",
  ADD COLUMN "group_code" INTEGER,
  ADD COLUMN "name_en" TEXT,
  ADD COLUMN "name_ar" TEXT,
  ADD COLUMN "bank_name" TEXT,
  ADD COLUMN "account_number" TEXT,
  ADD COLUMN "iban" TEXT,
  ADD COLUMN "note" TEXT,
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "created_by_id" TEXT;

-- The company bank account is CIB.
INSERT INTO "ledger_accounts" ("id", "key", "type", "created_at")
SELECT gen_random_uuid()::text, 'bank', 'bank', now()
WHERE NOT EXISTS (SELECT 1 FROM "ledger_accounts" WHERE "key" = 'bank');

-- One-of-a-kind company accounts take the first number of their group.
UPDATE "ledger_accounts" a SET "code" = v.code, "group_code" = v.grp, "category" = v.cat::"account_category",
  "name_en" = v.en, "name_ar" = v.ar
FROM (VALUES
  ('bank', '1101', 1100, 'asset', 'CIB', 'البنك التجاري الدولي CIB'),
  ('vat_payable', '2301', 2300, 'liability', 'VAT payable', 'ضريبة القيمة المضافة المستحقة'),
  ('revenue', '4101', 4100, 'revenue', 'Delivery and service fees', 'إيرادات رسوم التوصيل والخدمات'),
  ('rider_bonus_expense', '5101', 5100, 'expense', 'Rider delivery bonuses', 'حوافز توصيل المناديب'),
  ('damage_expense', '5201', 5200, 'expense', 'Damage paid by us', 'تعويضات التلفيات'),
  ('cash_difference', '5301', 5300, 'expense', 'Cash shortages and surpluses', 'عجز وزيادة النقدية')
) AS v(key, code, grp, cat, en, ar)
WHERE a."key" = v.key;
UPDATE "ledger_accounts" SET "bank_name" = 'CIB' WHERE "key" = 'bank';

-- Store cash boxes: 1201 onward, in store code order.
UPDATE "ledger_accounts" a SET "code" = (1200 + r.n)::text, "group_code" = 1200, "category" = 'asset'
FROM (SELECT l."id", row_number() OVER (ORDER BY d."code") AS n
      FROM "ledger_accounts" l JOIN "dark_stores" d ON d."id" = l."dark_store_id"
      WHERE l."type" = 'store_cash') r
WHERE a."id" = r."id";

-- Party wallets: <group>-0001 onward, oldest first.
UPDATE "ledger_accounts" a SET "code" = r.grp || '-' || lpad(r.n::text, 4, '0'), "group_code" = r.grp,
  "category" = r.cat::"account_category"
FROM (SELECT "id",
        CASE "type" WHEN 'rider_cash' THEN 1300 WHEN 'merchant' THEN 2100 ELSE 2200 END AS grp,
        CASE "type" WHEN 'rider_cash' THEN 'asset' ELSE 'liability' END AS cat,
        row_number() OVER (PARTITION BY "type" ORDER BY "created_at", "id") AS n
      FROM "ledger_accounts" WHERE "type" IN ('rider_cash', 'merchant', 'rider_bonus')) r
WHERE a."id" = r."id";

-- Starting accounts for owner money, other income and running costs.
INSERT INTO "ledger_accounts" ("id", "key", "type", "code", "group_code", "category", "name_en", "name_ar", "created_at")
SELECT gen_random_uuid()::text, v.key, v.type::"ledger_account_type", v.code, v.grp, v.cat::"account_category", v.en, v.ar, now()
FROM (VALUES
  ('equity:capital', 'equity', '3101', 3100, 'equity', 'Owner capital', 'رأس المال'),
  ('equity:drawings', 'equity', '3201', 3200, 'equity', 'Owner drawings', 'مسحوبات المالك'),
  ('other_income:general', 'other_income', '4201', 4200, 'revenue', 'Other income', 'إيرادات أخرى'),
  ('expense:rent', 'expense', '5401', 5400, 'expense', 'Rent', 'إيجار'),
  ('expense:salaries', 'expense', '5402', 5400, 'expense', 'Salaries and wages', 'مرتبات وأجور'),
  ('expense:fuel', 'expense', '5403', 5400, 'expense', 'Fuel and transport', 'وقود ومواصلات'),
  ('expense:packaging', 'expense', '5404', 5400, 'expense', 'Packaging and supplies', 'تغليف ومستلزمات'),
  ('expense:marketing', 'expense', '5405', 5400, 'expense', 'Marketing', 'تسويق'),
  ('expense:utilities', 'expense', '5406', 5400, 'expense', 'Utilities and internet', 'مرافق وإنترنت'),
  ('expense:maintenance', 'expense', '5407', 5400, 'expense', 'Maintenance', 'صيانة'),
  ('expense:government', 'expense', '5408', 5400, 'expense', 'Government fees', 'رسوم حكومية'),
  ('expense:other', 'expense', '5409', 5400, 'expense', 'Other expenses', 'مصروفات أخرى'),
  ('expense:bank_charges', 'expense', '5501', 5500, 'expense', 'Bank charges', 'مصاريف بنكية')
) AS v(key, type, code, grp, cat, en, ar)
ON CONFLICT ("key") DO NOTHING;

ALTER TABLE "ledger_accounts"
  ALTER COLUMN "code" SET NOT NULL,
  ALTER COLUMN "category" SET NOT NULL,
  ALTER COLUMN "group_code" SET NOT NULL;
CREATE UNIQUE INDEX "ledger_accounts_code_key" ON "ledger_accounts"("code");
CREATE INDEX "ledger_accounts_group_code_idx" ON "ledger_accounts"("group_code");

-- Serial numbers in date order. Ledger entries are append only, so the guard is lifted
-- only for this one numbering.
ALTER TABLE "ledger_entries" ADD COLUMN "number" INTEGER;
ALTER TABLE "ledger_entries" DISABLE TRIGGER "ledger_entries_append_only";
UPDATE "ledger_entries" e SET "number" = r.n
FROM (SELECT "id", row_number() OVER (ORDER BY "created_at", "occurred_at", "id") AS n FROM "ledger_entries") r
WHERE e."id" = r."id";
ALTER TABLE "ledger_entries" ENABLE TRIGGER "ledger_entries_append_only";
ALTER TABLE "ledger_entries" ALTER COLUMN "number" SET NOT NULL;
CREATE UNIQUE INDEX "ledger_entries_number_key" ON "ledger_entries"("number");

ALTER TABLE "payouts" ADD COLUMN "number" INTEGER;
UPDATE "payouts" p SET "number" = r.n
FROM (SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS n FROM "payouts") r
WHERE p."id" = r."id";
ALTER TABLE "payouts" ALTER COLUMN "number" SET NOT NULL;
CREATE UNIQUE INDEX "payouts_number_key" ON "payouts"("number");

ALTER TABLE "cash_handovers" ADD COLUMN "number" INTEGER;
UPDATE "cash_handovers" h SET "number" = r.n
FROM (SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS n FROM "cash_handovers") r
WHERE h."id" = r."id";
ALTER TABLE "cash_handovers" ALTER COLUMN "number" SET NOT NULL;
CREATE UNIQUE INDEX "cash_handovers_number_key" ON "cash_handovers"("number");
