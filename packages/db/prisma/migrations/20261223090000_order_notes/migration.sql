-- Order notes: an internal team thread and a thread shared with the merchant (append only).
CREATE TABLE "order_notes" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_notes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "order_notes_audience_check" CHECK ("audience" IN ('team', 'merchant')),
    CONSTRAINT "order_notes_body_check" CHECK (length(btrim("body")) BETWEEN 1 AND 1000)
);

CREATE INDEX "order_notes_order_id_audience_created_at_idx" ON "order_notes"("order_id", "audience", "created_at");

ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "order_notes_append_only" BEFORE UPDATE OR DELETE ON "order_notes"
  FOR EACH ROW EXECUTE FUNCTION "reject_append_only_change"();
