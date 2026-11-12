-- Refill levels per store and product (the store's default settings apply without a row).

-- CreateTable
CREATE TABLE "stock_targets" (
    "dark_store_id" TEXT NOT NULL,
    "sku_id" TEXT NOT NULL,
    "min_units" INTEGER NOT NULL,
    "max_units" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_targets_pkey" PRIMARY KEY ("dark_store_id","sku_id")
);

-- AddForeignKey
ALTER TABLE "stock_targets" ADD CONSTRAINT "stock_targets_dark_store_id_fkey" FOREIGN KEY ("dark_store_id") REFERENCES "dark_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_targets" ADD CONSTRAINT "stock_targets_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "stock_targets" ADD CONSTRAINT "stock_targets_levels_check" CHECK ("min_units" >= 0 AND "max_units" >= "min_units");
