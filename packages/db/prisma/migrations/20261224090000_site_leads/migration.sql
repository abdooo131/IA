-- Public website: merchants who ask for rates through the contact form.
CREATE TABLE "site_leads" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phone_valid" BOOLEAN NOT NULL,
    "website" TEXT,
    "orders_band" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "note" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "handled_by_id" TEXT,

    CONSTRAINT "site_leads_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "site_leads_status_check" CHECK ("status" IN ('new', 'contacted', 'won', 'lost')),
    CONSTRAINT "site_leads_orders_band_check" CHECK ("orders_band" IN ('under_300', '300_1000', '1000_5000', 'over_5000')),
    CONSTRAINT "site_leads_locale_check" CHECK ("locale" IN ('en', 'ar'))
);

CREATE UNIQUE INDEX "site_leads_idempotency_key_key" ON "site_leads"("idempotency_key");
CREATE INDEX "site_leads_status_created_at_idx" ON "site_leads"("status", "created_at");
CREATE INDEX "site_leads_created_at_idx" ON "site_leads"("created_at");

ALTER TABLE "site_leads" ADD CONSTRAINT "site_leads_handled_by_id_fkey" FOREIGN KEY ("handled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
