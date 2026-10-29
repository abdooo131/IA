# Shopify data collection and insights

Shiply Now collects each connected merchant's whole Shopify store so admin can understand every merchant alone and the market as a whole. No customer names, phones or emails are collected; an order keeps only its governorate, city and country.

## What is collected

| Data | Fields |
| --- | --- |
| Products | Shopify id, title, handle, status (live, draft, archived), vendor, product type, Shopify category, tags, main image, media count, total stock, created, updated and published dates |
| Variants | Shopify id, SKU, barcode, price, compare at price, unit cost, weight, options, stock, dates |
| Stock | per inventory item and location: available, on hand, committed, incoming; our dark store locations are marked so the merchant's own warehouses are told apart |
| Orders | Shopify id, name, dates (created, processed, updated, cancelled), payment and fulfillment status, subtotal, discounts, shipping, tax, total, refunded (all in piastres), units, sales channel, governorate and city, tags, test flag |
| Order lines | product, variant, SKU, title, vendor, quantity, current quantity, unit price, discount, total |
| Store profile | name, plan, currency, creation date, locations |

## How it runs

1. The Shopify job (every 20 seconds per shop) takes one step: products, then stock, then orders, each as a Shopify bulk export read line by line.
2. The first run takes everything (lifetime sales). Later runs, 24 hours apart, take only what changed.
3. orders/create and orders/updated webhooks save a new or changed order at once.
4. Every row is saved by its Shopify id, so running again changes nothing it already has.
5. If Shopify refuses order addresses, the orders export runs again without them and the run shows "without addresses".

## Insights

Admin, Data and insights (`/admin/data`):

* Market: sales by month, categories with share and growth (last 90 days against the 90 before), governorates, and merchants ranked by sales.
* One merchant (`/admin/data/<merchant id>`): catalogue mix, stock in their warehouses and with us, lifetime and recent sales, average order, discount rate, A B C products, best sellers, items running out (under 14 days of stock), items that stopped selling, categories, governorates, sales channels and the collection runs. "Collect everything again" starts a fresh full collection.

## One time setup

1. Orders older than 60 days need the `read_all_orders` scope, which Shopify grants on request: Partner Dashboard, the app, API access, "Read all orders scope", request it and explain we analyse the merchant's sales history to plan dark store stock.
2. Order addresses are protected customer data: in the same API access page, fill in "Protected customer data access" and ask for the Address field (Level 2 is not needed; we do not read names, emails or phones).
3. Once approved, set `SHOPIFY_EXTRA_SCOPES=read_all_orders` on Render. Each merchant then opens the app once in Shopify to approve the new scope.
4. In Admin, Shopify, press Register locations for each shop so the orders webhooks are added.
