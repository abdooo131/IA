-- The partner ledger was removed (agreed): a supplier is no longer linked to a merchant.
ALTER TABLE "suppliers" DROP CONSTRAINT "suppliers_merchant_id_fkey";
DROP INDEX "suppliers_merchant_id_key";
ALTER TABLE "suppliers" DROP COLUMN "merchant_id";
