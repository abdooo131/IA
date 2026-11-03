-- Demand model: product -> collection membership (may stay empty until collections are ingested).
-- When a style has no collection, its parent in the model is the store.

CREATE TABLE product_collection (
    tenant_id     BIGINT NOT NULL REFERENCES tenants,
    product_id    TEXT NOT NULL,
    collection_id TEXT NOT NULL,
    PRIMARY KEY (tenant_id, product_id, collection_id)
);
