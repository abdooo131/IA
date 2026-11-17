# Load test

Run on 27 Oct 2026 against a production build of the API (`node dist/main.js`) on a fresh,
seeded local database, with every store open and capacity lifted so nothing was refused.
The script is `scripts/load-test.mjs`.

The pilot expects about 20 orders an hour per store, 60 an hour across three stores.

## Orders and screens (20 requests at a time)

400 orders were created in 4.7 seconds (86 a second), then 2,000 screen loads ran in
24.3 seconds. Every request succeeded.

| Address | Calls | Median | 95% under | Slowest |
|---|---|---|---|---|
| Create order | 400 | 226 ms | 284 ms | 482 ms |
| Admin live view | 250 | 80 ms | 125 ms | 141 ms |
| Admin KPIs, 30 days | 250 | 163 ms | 211 ms | 241 ms |
| Merchant KPIs | 250 | 200 ms | 259 ms | 307 ms |
| Store summary | 250 | 155 ms | 208 ms | 256 ms |
| Coverage check | 250 | 184 ms | 248 ms | 294 ms |
| Admin orders list | 250 | 336 ms | 429 ms | 467 ms |
| Merchant orders list | 250 | 385 ms | 472 ms | 547 ms |
| Store order queue (400 active orders) | 250 | 422 ms | 516 ms | 585 ms |

The store queue had 400 active orders in one store, about 20 times a busy pilot hour.
Order lists return at most 200 rows and use the orders indexes, so they do not slow down
as months of orders build up.

## Checkout rate (Shopify waits only a few seconds)

200 signed rate requests for a five item cart, one after another, address already placed
on the map: median 28 ms, 95% under 40 ms, slowest 161 ms. The first request for a new
address also waits for Google geocoding (usually under a second); the answer is then cached.

## Notes

- The free Render instance sleeps when idle and takes up to a minute to wake, which is far
  longer than Shopify waits. Production must use an instance that stays awake.
- Admin KPIs read every order in the chosen range. At pilot volume a year is about 300,000
  orders, which is slow to read in one go; keep the default ranges (a week to a month) for
  daily use.
