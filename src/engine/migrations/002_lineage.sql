-- Product lineage: old variant -> replacement variant, styles, product -> style.

CREATE TABLE variant_lineage (
    tenant_id      BIGINT NOT NULL REFERENCES tenants,
    old_variant_id TEXT NOT NULL,
    new_variant_id TEXT NOT NULL,
    effective_date DATE,
    method         TEXT NOT NULL CHECK (method IN ('sku', 'title', 'manual')),
    confirmed      BOOLEAN NOT NULL DEFAULT FALSE,
    candidates     INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_id, old_variant_id, new_variant_id)
);
CREATE INDEX variant_lineage_new_idx ON variant_lineage (tenant_id, new_variant_id);

CREATE TABLE styles (
    tenant_id BIGINT NOT NULL REFERENCES tenants,
    style_id  TEXT NOT NULL,
    name      TEXT NOT NULL,
    PRIMARY KEY (tenant_id, style_id)
);

CREATE TABLE product_style (
    tenant_id  BIGINT NOT NULL REFERENCES tenants,
    product_id TEXT NOT NULL,
    style_id   TEXT NOT NULL,
    colour     TEXT,                -- NULL for an old multi colour product
    PRIMARY KEY (tenant_id, product_id),
    FOREIGN KEY (tenant_id, style_id) REFERENCES styles
);
