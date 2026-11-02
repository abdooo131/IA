-- Meta ad spend: ad level daily rows and catalog (product_id breakdown) daily rows.
-- Dates are stored as returned by Meta, i.e. in the ad account's timezone.

CREATE TABLE ad_spend_daily (
    tenant_id     BIGINT NOT NULL REFERENCES tenants,
    date          DATE NOT NULL,
    account_id    TEXT NOT NULL,
    campaign_id   TEXT,
    campaign_name TEXT,
    adset_id      TEXT,
    ad_id         TEXT NOT NULL,
    ad_name       TEXT,
    spend         NUMERIC NOT NULL DEFAULT 0,
    impressions   BIGINT NOT NULL DEFAULT 0,
    clicks        BIGINT NOT NULL DEFAULT 0,
    purchases     NUMERIC NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, date, account_id, ad_id)
);

-- catalog_product_id is the raw Meta product_id; re keyed to the current variant later via lineage.
CREATE TABLE catalog_spend_daily (
    tenant_id          BIGINT NOT NULL REFERENCES tenants,
    date               DATE NOT NULL,
    account_id         TEXT NOT NULL,
    ad_id              TEXT NOT NULL,
    catalog_product_id TEXT NOT NULL,
    spend              NUMERIC NOT NULL DEFAULT 0,
    impressions        BIGINT NOT NULL DEFAULT 0,
    purchases          NUMERIC NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, date, account_id, ad_id, catalog_product_id)
);
