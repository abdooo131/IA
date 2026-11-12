-- Accounting UX phase B: one bank statement line proven by several ledger lines that add up to
-- it exactly. The first ledger line stays on bank_statement_lines.ledger_line_id; the others
-- are kept here. A ledger line proves at most one bank line, wherever it is recorded.

CREATE TABLE "bank_line_matches" (
    "id" TEXT NOT NULL,
    "bank_line_id" TEXT NOT NULL,
    "ledger_line_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_line_matches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bank_line_matches_ledger_line_id_key" ON "bank_line_matches"("ledger_line_id");
CREATE INDEX "bank_line_matches_bank_line_id_idx" ON "bank_line_matches"("bank_line_id");

ALTER TABLE "bank_line_matches" ADD CONSTRAINT "bank_line_matches_bank_line_id_fkey" FOREIGN KEY ("bank_line_id") REFERENCES "bank_statement_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_line_matches" ADD CONSTRAINT "bank_line_matches_ledger_line_id_fkey" FOREIGN KEY ("ledger_line_id") REFERENCES "ledger_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A ledger line never proves two bank lines: not as an extra line of one and the first line of
-- another.
CREATE FUNCTION bank_line_match_unique() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'bank_line_matches' THEN
    IF EXISTS (SELECT 1 FROM bank_statement_lines WHERE ledger_line_id = NEW.ledger_line_id) THEN
      RAISE EXCEPTION 'ledger_line_matched';
    END IF;
  ELSIF NEW.ledger_line_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM bank_line_matches WHERE ledger_line_id = NEW.ledger_line_id) THEN
      RAISE EXCEPTION 'ledger_line_matched';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bank_line_matches_unique BEFORE INSERT OR UPDATE ON "bank_line_matches"
  FOR EACH ROW EXECUTE FUNCTION bank_line_match_unique();
CREATE TRIGGER bank_statement_lines_match_unique BEFORE INSERT OR UPDATE OF ledger_line_id ON "bank_statement_lines"
  FOR EACH ROW EXECUTE FUNCTION bank_line_match_unique();
