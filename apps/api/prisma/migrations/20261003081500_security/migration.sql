-- Extensions (PostGIS is used from Phase 2 for zone polygons).
CREATE EXTENSION IF NOT EXISTS postgis;

-- Tracking number sequence.
CREATE SEQUENCE IF NOT EXISTS tracking_number_seq START 1000;

-- Application role: no ownership, no BYPASSRLS, so row level security always applies to it.
-- The password is for local development only; production provisions this role outside migrations.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shiply_app') THEN
    CREATE ROLE shiply_app LOGIN PASSWORD 'shiply_app';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO shiply_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO shiply_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO shiply_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO shiply_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO shiply_app;
-- No hard deletes anywhere: the app role is never granted DELETE or TRUNCATE.
REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM shiply_app;

-- Request context helpers. The API sets these with set_config(..., true) inside each transaction.
CREATE OR REPLACE FUNCTION app_bypass_rls() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.bypass_rls', true), '') = 'on' $$;

CREATE OR REPLACE FUNCTION app_merchant_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.merchant_id', true), '')::uuid $$;

-- Append only tables.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % is append only (% rejected)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER order_events_append_only BEFORE UPDATE OR DELETE ON order_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER order_events_no_truncate BEFORE TRUNCATE ON order_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
REVOKE UPDATE ON audit_log, order_events FROM shiply_app;

-- Frozen order pricing: fee columns can never change after insert.
CREATE OR REPLACE FUNCTION freeze_order_pricing() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.shipping_fee IS DISTINCT FROM OLD.shipping_fee
     OR NEW.cod_fee IS DISTINCT FROM OLD.cod_fee
     OR NEW.open_package_fee IS DISTINCT FROM OLD.open_package_fee
     OR NEW.vat_amount IS DISTINCT FROM OLD.vat_amount
     OR NEW.total_fees IS DISTINCT FROM OLD.total_fees
     OR NEW.failed_delivery_fee IS DISTINCT FROM OLD.failed_delivery_fee
     OR NEW.pricing_snapshot IS DISTINCT FROM OLD.pricing_snapshot THEN
    RAISE EXCEPTION 'order pricing is frozen at creation' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_freeze_pricing BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION freeze_order_pricing();

-- Merchant bank details: editable once every N days (system_config merchant.bank_details_lock_days).
CREATE OR REPLACE FUNCTION enforce_bank_details_lock() RETURNS trigger
  LANGUAGE plpgsql AS $$
DECLARE
  lock_days int;
BEGIN
  SELECT (value #>> '{}')::int INTO lock_days FROM system_config WHERE key = 'merchant.bank_details_lock_days';
  lock_days := coalesce(lock_days, 15);
  IF OLD.last_changed_at > now() - make_interval(days => lock_days) THEN
    RAISE EXCEPTION 'bank details can only be changed once every % days', lock_days USING ERRCODE = 'check_violation';
  END IF;
  NEW.last_changed_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER merchant_bank_details_lock BEFORE UPDATE ON merchant_bank_details
  FOR EACH ROW EXECUTE FUNCTION enforce_bank_details_lock();

-- Row level security for merchant owned data.
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
CREATE POLICY merchant_isolation ON merchants
  USING (app_bypass_rls() OR id = app_merchant_id())
  WITH CHECK (app_bypass_rls() OR id = app_merchant_id());

ALTER TABLE merchant_bank_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY merchant_isolation ON merchant_bank_details
  USING (app_bypass_rls() OR merchant_id = app_merchant_id())
  WITH CHECK (app_bypass_rls() OR merchant_id = app_merchant_id());

ALTER TABLE pickup_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY merchant_isolation ON pickup_locations
  USING (app_bypass_rls() OR merchant_id = app_merchant_id())
  WITH CHECK (app_bypass_rls() OR merchant_id = app_merchant_id());

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY merchant_isolation ON orders
  USING (app_bypass_rls() OR merchant_id = app_merchant_id())
  WITH CHECK (app_bypass_rls() OR merchant_id = app_merchant_id());

ALTER TABLE order_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY merchant_isolation ON order_events
  USING (app_bypass_rls() OR merchant_id = app_merchant_id())
  WITH CHECK (app_bypass_rls() OR merchant_id = app_merchant_id());

ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY merchant_isolation ON import_batches
  USING (app_bypass_rls() OR merchant_id = app_merchant_id())
  WITH CHECK (app_bypass_rls() OR merchant_id = app_merchant_id());

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON audit_log FOR SELECT
  USING (app_bypass_rls() OR merchant_id = app_merchant_id());
CREATE POLICY audit_insert ON audit_log FOR INSERT
  WITH CHECK (true);

-- Customer success score needs history across all merchants without exposing rows.
CREATE OR REPLACE FUNCTION customer_success_stats(p_phone text)
  RETURNS TABLE(delivered bigint, unsuccessful bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*) FILTER (WHERE status = 'DELIVERED'),
         count(*) FILTER (WHERE status IN ('RETURNED', 'UNSUCCESSFUL', 'REJECTED_RETURN'))
  FROM orders WHERE customer_phone = p_phone
$$;
REVOKE ALL ON FUNCTION customer_success_stats(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION customer_success_stats(text) TO shiply_app;
