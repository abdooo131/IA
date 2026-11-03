-- Calibration: monthly Meta purchases -> Shopify orders factor, and per style lift test results.

CREATE TABLE calibration (
    tenant_id     BIGINT NOT NULL REFERENCES tenants,
    month         TEXT NOT NULL,              -- 'YYYY-MM'
    meta_factor   NUMERIC NOT NULL,
    utm_orders    NUMERIC NOT NULL DEFAULT 0,
    meta_purchases NUMERIC NOT NULL DEFAULT 0,
    capped        BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (tenant_id, month)
);

CREATE TABLE lift_tests (
    tenant_id BIGINT NOT NULL REFERENCES tenants,
    style_id  TEXT NOT NULL,
    factor    NUMERIC NOT NULL,
    tested_on DATE NOT NULL,
    PRIMARY KEY (tenant_id, style_id, tested_on)
);
