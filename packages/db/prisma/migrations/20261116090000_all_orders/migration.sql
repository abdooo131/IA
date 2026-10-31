-- Order exports run while the store had granted read_all_orders (lifetime history, not only
-- the last 60 days). The first such run takes every order again.
ALTER TABLE "shop_data_syncs" ADD COLUMN "all_orders" BOOLEAN NOT NULL DEFAULT false;
