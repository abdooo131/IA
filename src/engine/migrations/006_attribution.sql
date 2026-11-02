-- Attribution: manual ad -> product map, spend per product, unmapped spend log, per order credit.

CREATE TABLE ad_product_map (
    tenant_id  BIGINT NOT NULL REFERENCES tenants,
    ad_id      TEXT NOT NULL,
    product_id TEXT NOT NULL,        -- current colour product
    share      NUMERIC NOT NULL DEFAULT 1 CHECK (share >= 0),
    PRIMARY KEY (tenant_id, ad_id, product_id)
);

-- product_id is the current colour product, or '__pool__' when nothing could be split.
CREATE TABLE spend_by_product (
    tenant_id      BIGINT NOT NULL REFERENCES tenants,
    date           DATE NOT NULL,
    product_id     TEXT NOT NULL,
    method         TEXT NOT NULL CHECK (method IN ('catalog', 'name', 'manual', 'pool')),
    spend          NUMERIC NOT NULL DEFAULT 0,
    impressions    NUMERIC NOT NULL DEFAULT 0,
    meta_purchases NUMERIC NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, date, product_id, method)
);

-- Spend that no rule could attach to a product (it is still split by the pool rule).
CREATE TABLE unmapped_spend_log (
    tenant_id          BIGINT NOT NULL REFERENCES tenants,
    date               DATE NOT NULL,
    account_id         TEXT,
    ad_id              TEXT,
    ad_name            TEXT,
    catalog_product_id TEXT,
    spend              NUMERIC NOT NULL DEFAULT 0,
    impressions        NUMERIC NOT NULL DEFAULT 0,
    purchases          NUMERIC NOT NULL DEFAULT 0,
    reason             TEXT NOT NULL
);
CREATE INDEX unmapped_spend_log_idx ON unmapped_spend_log (tenant_id, date);

-- Credit per order and product; credits of an order sum to 1. ad_product_id = the order's ad product, if known.
CREATE TABLE order_credits (
    tenant_id     BIGINT NOT NULL REFERENCES tenants,
    order_id      TEXT NOT NULL,
    product_id    TEXT NOT NULL,
    credit        NUMERIC NOT NULL,
    ad_product_id TEXT,
    date          DATE NOT NULL,
    PRIMARY KEY (tenant_id, order_id, product_id)
);
CREATE INDEX order_credits_date_idx ON order_credits (tenant_id, date);
