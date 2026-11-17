-- Shopify apps besides the main one (a custom app per pilot merchant) and the app each store uses.
-- AlterTable
ALTER TABLE "shopify_shops" ADD COLUMN     "app_id" TEXT;


-- CreateTable
CREATE TABLE "shopify_apps" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret_enc" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopify_apps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shopify_apps_client_id_key" ON "shopify_apps"("client_id");

-- AddForeignKey
ALTER TABLE "shopify_shops" ADD CONSTRAINT "shopify_shops_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "shopify_apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

