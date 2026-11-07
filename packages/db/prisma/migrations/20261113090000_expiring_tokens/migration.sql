-- Expiring offline Shopify tokens: the access token's expiry and the (encrypted) refresh token.
-- AlterTable
ALTER TABLE "shopify_shops" ADD COLUMN     "access_token_expires_at" TIMESTAMP(3),
ADD COLUMN     "refresh_token_enc" TEXT,
ADD COLUMN     "refresh_token_expires_at" TIMESTAMP(3);


