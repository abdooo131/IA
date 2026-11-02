-- Purchasing: which forecast run suggested a PO (re running suggest_pos replaces that run's drafts),
-- and the numbers behind each suggested line (forecast, safety, available, on order, flags).

ALTER TABLE purchase_orders ADD COLUMN run_id TEXT;
CREATE INDEX purchase_orders_run_idx ON purchase_orders (tenant_id, run_id, state);

ALTER TABLE po_lines ADD COLUMN detail JSONB NOT NULL DEFAULT '{}';
