# Shopify data collection and insights

Shiply Now collects each connected merchant's whole Shopify store so admin can understand every merchant alone, the market as a whole, and every shopper across all merchants (the customer base, see below).

## What is collected

| Data | Fields |
| --- | --- |
| Products | Shopify id, title, handle, status (live, draft, archived), vendor, product type, Shopify category, tags, main image, media count, total stock, created, updated and published dates |
| Variants | Shopify id, SKU, barcode, price, compare at price, unit cost, weight, options, stock, dates |
| Stock | per inventory item and location: available, on hand, committed, incoming; our dark store locations are marked so the merchant's own warehouses are told apart |
| Orders | Shopify id, name, dates (created, processed, updated, cancelled), payment and fulfillment status, subtotal, discounts, shipping, tax, total, refunded (all in piastres), refunds (date, note, amount, kept in the raw row), units, sales channel, payment gateways (and from them cod, card or other), the shipping line chosen (code and title; `SN60:<store>` marks our 60 minute rate), discount codes, cancel reason, tags, test flag; with buyer details also email, phone and Shopify customer, delivery name, phone, street, governorate, city and Shopify's map point of the address, and the cart attributes (our `_shiplynow_zone`, `_shiplynow_area`, `_shiplynow_pin`) |
| Customers | Shopify id, first and last name, email and phone with their marketing consent, language (locale), default address with its map point, number of orders, amount spent, state, tags, created and updated dates (other saved addresses are a nested list Shopify serves as a connection and are not read) |
| Order lines | product, variant, SKU, title, vendor, quantity, current quantity, unit price, discount, total |
| Store profile | name, plan, currency, creation date, locations |

## How it runs

After the release that added the payment, shipping line, discount, cancel reason, cart attribute, map point and locale fields, orders and customers are read again in full once (the migration marks their last exports superseded), so older rows get them too.

1. The Shopify job (every 20 seconds per shop) takes one step: products, then stock, then orders, then customers, each as a Shopify bulk export read line by line.
2. The first run takes everything (lifetime sales). Later runs, 24 hours apart, take only what changed.
3. orders/create and orders/updated webhooks save a new or changed order at once.
4. Every row is saved by its Shopify id, so running again changes nothing it already has.
5. Buyer details are protected customer data. If Shopify refuses them, the orders export runs again with less: first without contact details (governorate and city only), then without any address; the customers export waits for the next day. Once Shopify approves, press "Collect everything again" on the merchant's data page so older orders get their buyer details.
6. A failed export is tried again after an hour, not on every step.

## Customer base

Admin, Customers (`/admin/customers`) shows one profile per person across every merchant and our own deliveries.

* Matching: the Egyptian mobile first (any format, stored as +20), then the email. Shopify customers, Shopify orders and our delivery orders (linked by a job every 30 seconds) all point at the same person. Foreign or invalid numbers are not matched.
* First seen is the earliest date anything knows the person by: a Shopify customer record's creation, a Shopify order or one of our orders (never the record's last update).
* Partial order history: without `read_all_orders` a store gives only its last 60 days of orders. Until a full orders export with that permission is done, a customer record created before the oldest order we hold of that store counts at least Shopify's own number of orders and amount spent (the orders we lack are dated before that oldest order, the first one at the record's creation). Segments, value and repeat buying use these numbers; the API marks them `fromShopifyTotals` and the list shows them with *. The customers and data pages show, per store, the order history we hold (from, to, how many) and whether it is complete.
* Export: Customers, Export downloads a segment (or everyone) as CSV: phone, email, name, segment, email and SMS consent, last order. "For marketing" keeps only people whose consent is SUBSCRIBED (in at least one store and unsubscribed in none), and of them only the channel they agreed to. It needs customer data access and each export writes customer.export with the row count to the audit log.
* A profile shows contact details and address, spend, orders, average order, how often they buy, merchants they buy from, categories and products, orders by weekday and hour (Cairo), how they pay (cash on delivery or card, from the payment gateways), how many orders chose our 60 minute rate against the merchant's own delivery, deliveries with us (delivered, failed, cash, rating), their record in each merchant store with marketing consent, and every order.
* Segments come from settings: VIP (customer.vip_orders), new (customer.new_days), at risk (customer.at_risk_days), lost (customer.lost_days), loyal, one time, no orders.
* The overview shows buyers, repeat rate, shoppers who buy from two or more merchants, new customers by month, governorates and which merchants share shoppers.
* Privacy: admin only; opening a profile writes customer.view to the audit log. Shopify's customers/redact deletes that buyer's record and the contact details on the named orders (totals stay), and shop/redact does the same for the whole shop; a person is deleted once no merchant and no delivery of ours knows them.

## Value, risk, places and cross selling (admin only, never in the merchant area)

* Value: spend in the last 30, 90 and 365 days, spend by month, the date a repeat customer usually orders again, a "should have ordered" list (past customer.late_factor_pct of their usual gap), and a 12 month forecast (orders a year times the average order; at risk customers count at customer.at_risk_value_pct, lost ones not at all).
* Price level: what the customer pays against the median price of the same category across every merchant; below customer.budget_index_pct is budget, above customer.premium_index_pct is premium.
* Cash on delivery risk: from our own finished delivery attempts, failed attempts with refusals counted twice as a share of attempts. Fewer than customer.risk_min_attempts attempts give "not enough history" (or medium after a refusal); customer.risk_medium_pct and customer.risk_high_pct set the levels. A new cash order from a high risk customer raises one cod_risk_customer alert for admin; admin's order page shows the customer's risk. Merchants never see this alert.
* Places: a job places each new or changed customer in a district (geo_areas level 2), from the latest point first (our own orders, a Shopify order's pin, then Shopify's point of the address, read through the one delivery decision), else by reading the address with the area engine. /admin/customers/places ranks districts by spend over the last 12 months with how much of each our zones cover.
* Cross selling: admin's merchant data page shows what that merchant's customers buy at other merchants in categories it does not sell; the customer overview shows categories bought together (lift above 1 means more than chance) and merchants that share shoppers.
* Data care: admin merges two profiles of one person (the other's phone and email stay as aliases so new orders still find the kept profile; audited as customer.merge). Profiles show others at the same address and the marketing consent from each store.
* Timing: when the customer base buys (day and Cairo hour) and the three busiest hours per store over 90 days.

## Legal note

Building one named profile across merchants is the business's decision. Before going live: Shopify must approve protected customer data (level 2: name, email, phone, address) with this purpose written honestly in the request, every merchant contract must allow it, the tracking page needs a privacy notice, and a lawyer should confirm what Egypt's Personal Data Protection Law (151 of 2020) requires, including any license from the Data Protection Center.

## Insights

Admin, Data and insights (`/admin/data`):

* Market: sales by month, categories with share and growth (last 90 days against the 90 before), governorates, and merchants ranked by sales.
* One merchant (`/admin/data/<merchant id>`): catalogue mix, stock in their warehouses and with us, lifetime and recent sales, average order, discount rate, A B C products, best sellers, items running out (under 14 days of stock), items that stopped selling, categories, governorates, sales channels and the collection runs. "Collect everything again" starts a fresh full collection.

## One time setup

1. Orders older than 60 days need the `read_all_orders` scope. The app asks for it at every install, and shopify.app.toml (the base of every merchant kit and of `pnpm shopify:merchant-app`) lists it; a test keeps the install scopes and the TOML the same. An app the store made in its own Dev Dashboard (every merchant's custom app) gets it without Shopify approval: the merchant runs the kit's `npx @shopify/cli@latest app deploy` once more (or `pnpm shopify:merchant-app` for apps we deploy), then approves the new permission (Install on my store, or Connect now; a store on the client credentials grant picks it up at its next daily token by itself). The first orders export after it is granted takes the whole history, then only changes. Only the unused main app would need Shopify's approval first (Partner Dashboard, the app, API access requests, Read all orders scope).
2. Buyer details are protected customer data: in the same API access page, fill in "Protected customer data access" and ask for level 2 with the Name, Email, Phone and Address fields, explaining that we build one customer profile across the merchants we deliver for.
3. `SHOPIFY_EXTRA_SCOPES` on Render adds any further permission Shopify approves later. The app also asks for `read_customers` (the store's customer list). Each merchant then opens the app once in Shopify to approve the new permissions; for the app's own settings run `shopify app deploy` so Shopify knows the new scope list.
4. In Admin, Shopify, press Register locations for each shop so the orders webhooks are added.
