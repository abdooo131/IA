-- First seen is the earliest date anything knows the person by: a Shopify customer record's
-- creation, a Shopify order or one of our orders. Customer records used to be read with their
-- last update first, which put first seen too late. It only ever moves the date back, so
-- running it again changes nothing.
UPDATE "customers" c SET "first_seen_at" = e.first_at
FROM (
  SELECT customer_id, MIN(at) AS first_at FROM (
    SELECT customer_id, created_at_shop AS at FROM shop_customers
      WHERE customer_id IS NOT NULL AND created_at_shop IS NOT NULL
    UNION ALL
    SELECT customer_id, created_at_shop FROM shop_orders WHERE customer_id IS NOT NULL
    UNION ALL
    SELECT customer_id, placed_at FROM orders WHERE customer_id IS NOT NULL
  ) x GROUP BY customer_id
) e
WHERE e.customer_id = c.id AND e.first_at < c.first_seen_at;

-- Orders and customers are read again in full once, so the new fields (map point, payment,
-- shipping line, discount codes, cancel reason, cart attributes, locale) reach older rows.
UPDATE "shop_data_syncs" SET "status" = 'superseded'
WHERE "kind" IN ('orders', 'customers') AND "status" = 'done';
