-- Returns closed short: units not found are recorded per line and no longer claimed.
ALTER TABLE "merchant_return_lines" ADD COLUMN "short_qty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "merchant_return_lines" ADD CONSTRAINT "merchant_return_lines_short_check"
  CHECK ("short_qty" >= 0 AND "picked_qty" + "short_qty" <= "quantity");

-- Manual orders carry the form's idempotency key: a repeat answers the first order.
ALTER TABLE "orders" ADD COLUMN "idempotency_key" TEXT;
CREATE UNIQUE INDEX "orders_idempotency_key_key" ON "orders"("idempotency_key");
