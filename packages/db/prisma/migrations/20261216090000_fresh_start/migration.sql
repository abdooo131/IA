-- The one time fresh start (packages/db/src/fresh-start.ts): a row here means the demo
-- activity was wiped, so the routine never runs twice and the seed and the demo loader no
-- longer add sample merchants, people or stock.
CREATE TABLE "fresh_starts" (
    "id" TEXT NOT NULL DEFAULT 'fresh_start',
    "ran_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kept_merchants" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "counts" JSONB NOT NULL,

    CONSTRAINT "fresh_starts_pkey" PRIMARY KEY ("id")
);
