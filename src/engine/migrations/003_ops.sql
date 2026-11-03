-- Operations tables: locations, stock, purchasing, decisions, plans, landing sessions.

CREATE TABLE locations (
    tenant_id   BIGINT NOT NULL REFERENCES tenants,
    location_id TEXT NOT NULL,
    name        TEXT,
    PRIMARY KEY (tenant_id, location_id)
);

CREATE TABLE stock_daily (
    tenant_id     BIGINT NOT NULL REFERENCES tenants,
    date          DATE NOT NULL,
    variant_id    TEXT NOT NULL,
    location_id   TEXT NOT NULL,
    available     INTEGER NOT NULL,
    on_hand       INTEGER NOT NULL,
    reconstructed BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (tenant_id, date, variant_id, location_id)
);
CREATE INDEX stock_daily_variant_idx ON stock_daily (tenant_id, variant_id, date);

-- Units received into a location on a date (from read transfer receipts); used to walk stock backwards.
CREATE TABLE stock_receipts (
    id          BIGSERIAL PRIMARY KEY,
    tenant_id   BIGINT NOT NULL REFERENCES tenants,
    date        DATE NOT NULL,
    variant_id  TEXT NOT NULL,
    location_id TEXT NOT NULL,
    qty         INTEGER NOT NULL,
    source      TEXT                       -- e.g. PO number or transfer id
);
CREATE INDEX stock_receipts_idx ON stock_receipts (tenant_id, variant_id, date);

CREATE TABLE suppliers (
    supplier_id   BIGSERIAL PRIMARY KEY,
    tenant_id     BIGINT NOT NULL REFERENCES tenants,
    name          TEXT NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('factory', 'external')),
    lead_time_days INTEGER NOT NULL,
    pack_multiple INTEGER NOT NULL DEFAULT 1,
    UNIQUE (tenant_id, name)
);

CREATE TABLE product_suppliers (
    id          BIGSERIAL PRIMARY KEY,
    tenant_id   BIGINT NOT NULL REFERENCES tenants,
    supplier_id BIGINT NOT NULL REFERENCES suppliers,
    style_id    TEXT,
    product_id  TEXT,
    moq         INTEGER NOT NULL DEFAULT 0,
    CHECK (style_id IS NOT NULL OR product_id IS NOT NULL)
);
CREATE UNIQUE INDEX product_suppliers_uq
    ON product_suppliers (tenant_id, COALESCE(style_id, ''), COALESCE(product_id, ''));

CREATE TABLE purchase_orders (
    tenant_id   BIGINT NOT NULL REFERENCES tenants,
    po_number   TEXT NOT NULL,
    supplier_id BIGINT REFERENCES suppliers,
    state       TEXT NOT NULL DEFAULT 'draft'
                CHECK (state IN ('draft','approved','pushed','partially_received','received','cancelled')),
    transfer_id TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_at TIMESTAMPTZ,
    pushed_at   TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, po_number)
);

CREATE TABLE po_lines (
    tenant_id     BIGINT NOT NULL,
    po_number     TEXT NOT NULL,
    variant_id    TEXT NOT NULL,
    qty_suggested INTEGER NOT NULL DEFAULT 0,
    qty_approved  INTEGER,
    qty_received  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, po_number, variant_id),
    FOREIGN KEY (tenant_id, po_number) REFERENCES purchase_orders
);

CREATE TABLE decisions (
    id        BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants,
    run_id    TEXT NOT NULL,
    month     DATE NOT NULL,
    level     TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    decision  TEXT NOT NULL,
    rule      TEXT,
    numbers   JSONB NOT NULL DEFAULT '{}',
    flags     JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX decisions_idx ON decisions (tenant_id, run_id, level, entity_id, month);

CREATE TABLE product_plans (
    id          BIGSERIAL PRIMARY KEY,
    tenant_id   BIGINT NOT NULL REFERENCES tenants,
    run_id      TEXT NOT NULL,
    entity_id   TEXT NOT NULL,
    month       DATE NOT NULL,
    spend       NUMERIC,
    units       NUMERIC,
    true_demand NUMERIC,
    revenue     NUMERIC,
    profit      NUMERIC,
    po_number   TEXT
);
CREATE INDEX product_plans_idx ON product_plans (tenant_id, run_id, entity_id, month);

CREATE TABLE landing_sessions (
    tenant_id BIGINT NOT NULL REFERENCES tenants,
    date      DATE NOT NULL,
    handle    TEXT NOT NULL,
    sessions  INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, date, handle)
);
