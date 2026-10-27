-- Failed deliveries can be tried again: a failed attempt waits in attempt_failed for the goods
-- to come back and for a decision (retry, ship normally, cancel) until retry_hold_until.

-- AlterEnum
ALTER TYPE "order_status" ADD VALUE 'attempt_failed' AFTER 'out_for_delivery';

-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "call_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "failed_photo_id" TEXT,
ADD COLUMN     "returned_at" TIMESTAMP(3);
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_call_attempts_check" CHECK ("call_attempts" >= 0);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "retry_hold_until" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_failed_photo_id_fkey" FOREIGN KEY ("failed_photo_id") REFERENCES "photos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Attempts that failed before this change were already handled by hand: count them as back,
-- so the goods_not_returned check only watches new attempts.
UPDATE "deliveries" SET "returned_at" = COALESCE("failed_at", CURRENT_TIMESTAMP)
WHERE "status" = 'failed' AND "returned_at" IS NULL;
