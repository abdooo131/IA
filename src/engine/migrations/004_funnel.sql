-- Storefront funnel: raw pixel events and the daily roll-up. Depends only on 001_core (tenants).
-- session_hash is sha256(pixel_key || ':' || session_id); no raw session id or other personal data is stored.

CREATE TABLE pixel_events (
    tenant_id    BIGINT NOT NULL REFERENCES tenants,
    ts           TIMESTAMPTZ NOT NULL,
    session_hash TEXT NOT NULL,
    event        TEXT NOT NULL CHECK (event IN
                   ('product_viewed', 'product_added_to_cart', 'checkout_completed', 'size_selected', 'notify_me')),
    product_id   TEXT,
    variant_id   TEXT,
    available    BOOLEAN
);
CREATE INDEX pixel_events_idx ON pixel_events (tenant_id, ts);

CREATE TABLE funnel_daily (
    tenant_id              BIGINT NOT NULL REFERENCES tenants,
    date                   DATE NOT NULL,
    product_id             TEXT NOT NULL,
    variant_id             TEXT NOT NULL DEFAULT '',   -- '' = product level row (views, atc, orders)
    views                  INTEGER NOT NULL DEFAULT 0,
    size_views             INTEGER NOT NULL DEFAULT 0,
    size_views_unavailable INTEGER NOT NULL DEFAULT 0,
    atc                    INTEGER NOT NULL DEFAULT 0,
    orders                 INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, date, product_id, variant_id)
);
