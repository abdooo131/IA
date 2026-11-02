CREATE TABLE tenants (
    tenant_id         BIGSERIAL PRIMARY KEY,
    name              TEXT NOT NULL UNIQUE,
    shop_domain       TEXT NOT NULL UNIQUE,
    shopify_token_env TEXT NOT NULL,   -- NAME of env var, never the token
    meta_token_env    TEXT NOT NULL,   -- NAME of env var, never the token
    meta_account_ids  TEXT[] NOT NULL DEFAULT '{}',
    timezone          TEXT NOT NULL,
    currency          TEXT NOT NULL,
    po_prefix         TEXT NOT NULL,
    main_location_id  TEXT,
    pixel_key         TEXT NOT NULL UNIQUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
    tenant_id         BIGINT NOT NULL REFERENCES tenants,
    variant_id        TEXT NOT NULL,
    product_id        TEXT NOT NULL,
    handle            TEXT,
    title             TEXT,
    colour            TEXT,
    size              TEXT,
    sku               TEXT,
    inventory_item_id TEXT,
    unit_cost         NUMERIC,
    status            TEXT,
    created_at        TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, variant_id)
);
CREATE INDEX products_product_idx ON products (tenant_id, product_id);

CREATE TABLE sales_lines (
    tenant_id    BIGINT NOT NULL REFERENCES tenants,
    order_id     TEXT NOT NULL,
    date         DATE NOT NULL,
    variant_id   TEXT NOT NULL,
    qty          INTEGER NOT NULL,
    line_value   NUMERIC NOT NULL,
    customer_key TEXT
);
CREATE INDEX sales_lines_idx ON sales_lines (tenant_id, date, variant_id);
CREATE INDEX sales_lines_order_idx ON sales_lines (tenant_id, order_id);

CREATE TABLE orders (
    tenant_id    BIGINT NOT NULL REFERENCES tenants,
    order_id     TEXT NOT NULL,
    date         DATE NOT NULL,
    customer_key TEXT,
    utm_source   TEXT,
    utm_content  TEXT,
    total        NUMERIC NOT NULL,
    PRIMARY KEY (tenant_id, order_id)
);
CREATE INDEX orders_date_idx ON orders (tenant_id, date);

CREATE TABLE calendar (
    tenant_id BIGINT NOT NULL REFERENCES tenants,
    date      DATE NOT NULL,
    flags     JSONB NOT NULL DEFAULT '{}',   -- e.g. {"holiday": true, "sale": "bf"}
    PRIMARY KEY (tenant_id, date)
);

-- Generic model/forecast stores; later migrations may add columns.
CREATE TABLE model_params (
    id         BIGSERIAL PRIMARY KEY,
    tenant_id  BIGINT NOT NULL REFERENCES tenants,
    run_id     TEXT NOT NULL,
    entity_id  TEXT NOT NULL,
    period     DATE,
    params     JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX model_params_idx ON model_params (tenant_id, run_id, entity_id);

CREATE TABLE forecasts (
    id         BIGSERIAL PRIMARY KEY,
    tenant_id  BIGINT NOT NULL REFERENCES tenants,
    run_id     TEXT NOT NULL,
    entity_id  TEXT NOT NULL,
    period     DATE NOT NULL,
    grain      TEXT NOT NULL DEFAULT 'month',
    params     JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX forecasts_idx ON forecasts (tenant_id, run_id, entity_id, period);

CREATE TABLE forecast_accuracy (
    id         BIGSERIAL PRIMARY KEY,
    tenant_id  BIGINT NOT NULL REFERENCES tenants,
    run_id     TEXT NOT NULL,
    entity_id  TEXT NOT NULL,
    period     DATE NOT NULL,
    params     JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX forecast_accuracy_idx ON forecast_accuracy (tenant_id, run_id, entity_id, period);
