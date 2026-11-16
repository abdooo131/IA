-- The deferred balance trigger sums ledger_lines by entry_id for every inserted line.
CREATE INDEX "ledger_lines_entry_id_idx" ON "ledger_lines"("entry_id");

-- The push dispatcher reads these by time every 10 seconds.
CREATE INDEX "transfers_sent_at_idx" ON "transfers"("sent_at");
CREATE INDEX "payouts_paid_at_idx" ON "payouts"("paid_at");
CREATE INDEX "expense_claims_updated_at_idx" ON "expense_claims"("updated_at");
