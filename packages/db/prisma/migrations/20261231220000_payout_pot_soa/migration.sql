-- Payout proof of transfer and statement of account (owner, 2026-11-11). A payout's statement
-- of account (SOA-000001) is frozen when it is prepared; marking it paid needs a proof of
-- transfer (POT-000001: the bank slip with the amount and reference typed from it) and every
-- active payout check ticked, the system check second_person_viewed by someone other than
-- the payer. A payout paid by cheque has the cheque register as its proof.

-- CreateTable
CREATE TABLE "payout_statements" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "payout_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "period_from" TIMESTAMP(3) NOT NULL,
    "period_to" TIMESTAMP(3) NOT NULL,
    "opening_piastres" INTEGER NOT NULL,
    "closing_piastres" INTEGER NOT NULL,
    "held_back_piastres" INTEGER NOT NULL,
    "net_piastres" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_proofs" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "payout_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "amount_piastres" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_checks" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "label_ar" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_check_marks" (
    "id" TEXT NOT NULL,
    "payout_id" TEXT NOT NULL,
    "check_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_check_marks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payout_statements_number_key" ON "payout_statements"("number");

-- CreateIndex
CREATE UNIQUE INDEX "payout_statements_payout_id_key" ON "payout_statements"("payout_id");

-- CreateIndex
CREATE INDEX "payout_statements_merchant_id_idx" ON "payout_statements"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "payout_proofs_number_key" ON "payout_proofs"("number");

-- CreateIndex
CREATE UNIQUE INDEX "payout_proofs_payout_id_key" ON "payout_proofs"("payout_id");

-- CreateIndex
CREATE UNIQUE INDEX "payout_checks_code_key" ON "payout_checks"("code");

-- CreateIndex
CREATE UNIQUE INDEX "payout_check_marks_payout_id_check_id_key" ON "payout_check_marks"("payout_id", "check_id");

-- AddForeignKey
ALTER TABLE "payout_statements" ADD CONSTRAINT "payout_statements_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_statements" ADD CONSTRAINT "payout_statements_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_statements" ADD CONSTRAINT "payout_statements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_proofs" ADD CONSTRAINT "payout_proofs_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_proofs" ADD CONSTRAINT "payout_proofs_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_checks" ADD CONSTRAINT "payout_checks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_check_marks" ADD CONSTRAINT "payout_check_marks_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_check_marks" ADD CONSTRAINT "payout_check_marks_check_id_fkey" FOREIGN KEY ("check_id") REFERENCES "payout_checks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_check_marks" ADD CONSTRAINT "payout_check_marks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A statement of account never changes once frozen.
CREATE FUNCTION payout_statement_frozen() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'payout_statement_frozen' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payout_statements_frozen
  BEFORE UPDATE OR DELETE ON "payout_statements"
  FOR EACH ROW EXECUTE FUNCTION payout_statement_frozen();

-- The proof and the check marks of a paid payout are fixed.
CREATE FUNCTION payout_paid_frozen() RETURNS trigger AS $$
DECLARE
  v_status "payout_status";
BEGIN
  SELECT status INTO v_status FROM "payouts" WHERE id = OLD.payout_id;
  IF v_status = 'paid' THEN
    RAISE EXCEPTION 'payout_paid_frozen' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payout_proofs_frozen
  BEFORE UPDATE OR DELETE ON "payout_proofs"
  FOR EACH ROW EXECUTE FUNCTION payout_paid_frozen();

CREATE TRIGGER payout_check_marks_frozen
  BEFORE UPDATE OR DELETE ON "payout_check_marks"
  FOR EACH ROW EXECUTE FUNCTION payout_paid_frozen();

-- Money on a proof or a statement's net is never zero or below.
ALTER TABLE "payout_proofs" ADD CONSTRAINT "payout_proofs_amount_positive" CHECK ("amount_piastres" > 0);
ALTER TABLE "payout_statements" ADD CONSTRAINT "payout_statements_net_positive" CHECK ("net_piastres" > 0);

-- The system check: a second person viewed the SOA and the POT.
INSERT INTO "payout_checks" ("id", "code", "label_en", "label_ar", "active", "system", "sort", "updated_at")
VALUES ('payout_check_second_person_viewed', 'second_person_viewed', 'Second person viewed the statement and the proof of transfer', 'شخص ثان راجع كشف الحساب وإثبات التحويل', true, true, 0, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
