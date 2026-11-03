-- Cycle runs: one row per tenant run. run_id = '<YYYYMM of the decided month>-<UTC timestamp>'.
-- stages holds one JSON object per stage: {seq, status, seconds, result | error}.

CREATE TABLE runs (
    tenant_id   BIGINT NOT NULL REFERENCES tenants,
    run_id      TEXT NOT NULL,
    month       TEXT NOT NULL,                 -- 'YYYY-MM', the previous complete month the run decides
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    status      TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
    stages      JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (tenant_id, run_id)
);
CREATE INDEX runs_status_idx ON runs (tenant_id, status, started_at);
