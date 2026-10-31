# Shiply Now: plan v2 (CEO review, scope expansion)

Date: 2026-10-27. Branch: ShiplyNow. Review mode: SCOPE EXPANSION (decision D1).

## Where the pilot stands

Steps 1 to 11 are built and live on Render plus Neon: stores and zones, catalog, stock, receiving,
counts, Shopify app (fulfillment service, carrier rates, widget), order queue, staff, rider, admin,
finance, failed deliveries. What the business still cannot do:

1. The customer never sees the delivery code or where the order is.
2. Nobody can see the rider on the road.
3. We never hear from the customer after delivery.
4. A merchant cannot take stock back out of a dark store.
5. Damaged units have no owner: nobody pays, nobody is charged.
6. Every merchant is created by hand by admin.

## Accepted scope (decisions D3, D5, D6, D8, plus the tracking page)

| # | Feature | Decision |
|---|---------|----------|
| 1 | Customer tracking page with the 4 digit delivery code, linked from Shopify's tracking URL | Base of the expansion |
| 2 | Live rider position on the tracking page while the order is out for delivery | D3 add |
| 3 | Proof photo on the tracking page and a 1 to 5 rating with a comment, ratings in merchant and admin KPIs | D5 add |
| 4 | Return stock to the merchant (outbound shipment) | Gap from "what is missing" |
| 5 | Damaged stock settlement: cause chosen by staff, admin approves, company pays the merchant for store or delivery damage and may charge the rider; the merchant bears damage that arrived damaged or that the customer caused | D8 |
| 6 | Merchant self sign up: request form, admin approval, then the merchant signs in and finishes onboarding | D6 add |

## Cut or deferred

- Partial delivery: cut (D7).
- Customer returns after delivery: cut, the merchant handles them (D9).
- WhatsApp or SMS messages to customers: deferred (D2), see TODOS.md.
- Customer self reschedule: deferred (D4), see TODOS.md.
- Earlier items still open: Phase B, photo file storage, Shiply core integration, real zone borders.

## Design per feature

### 1. Tracking page

- Every order gets an unguessable `tracking_token` (24 random url safe characters) at creation.
- Public page `/t/<token>` (no sign in), Arabic and English, mobile first: order number, merchant,
  status steps, promise time, rider first name while out for delivery, the delivery code while the
  order is not yet delivered, COD amount to prepare.
- Public API `GET /track/:token`. Never shows the customer's address or phone, only what the
  customer already knows. Unknown token answers 404.
- Shopify: `fulfillmentCreate` sends `trackingInfo.url` = `<WEB_ORIGIN>/t/<token>`, so Shopify's
  shipping email and order status page link to it.
- The delivery code stays hidden from merchants (Step 7 rule); only the customer link shows it.

### 2. Live rider map

- Rider app sends the phone position every `tracking.rider_ping_seconds` (setting, default 20)
  while the rider has an order out for delivery: `POST /rider/location`.
- Stored on `riders.last_lat`, `last_lng`, `last_location_at` (latest only, no history; privacy).
- Tracking page shows a Leaflet map with the rider and the drop point only while the order is
  `out_for_delivery` and the position is fresher than `tracking.rider_stale_minutes` (default 5).
  It refreshes every 15 seconds.

### 3. Proof and rating

- After delivery the tracking page shows the handover photo (served through the token, not the
  photo id) and a 1 to 5 star rating with an optional comment, once per order.
- Table `order_ratings` (order_id unique, stars 1..5 CHECK, comment, created_at).
- KPIs: average rating and count in admin KPIs and in the merchant overview.
- A rating of 1 or 2 raises a `low_rating` admin alert.

### 4. Return stock to merchant

- Merchant creates an outbound request from `/merchant/shipments` (return tab): store, products,
  quantities. Only available units can be requested; they are reserved at once (movement type
  `reserve` with reason `return_to_merchant`) so orders cannot sell them.
- Staff see it in their store, pick by scan from shelves, then confirm handover with the name of
  who collected it. Picking removes units through a new movement type `dispatch`.
- Status: requested, picking, ready, collected, cancelled. Merchant can cancel until collected;
  cancel releases reservations.
- Fee: `fee.return_per_unit` setting (per merchant override), posted on collection.

### 5. Damaged stock settlement

- Staff report damage from the store: product, quantity, from which bin, cause:
  `arrived_damaged`, `store_handling`, `delivery`, `customer`, `expired`, plus a note and an
  optional photo. Units move to the damaged bin at once (not sellable).
- Admin approves or rejects (and may change the cause). Approved:
  - store_handling or delivery: the company pays the merchant the unit price
    (`damage_compensation` entry: expense to merchant account). If the cause is delivery and a
    rider is named, admin may choose to charge the rider (rider owes it).
  - arrived_damaged, customer, expired: the merchant bears it, no money moves.
- Units in the damaged bin are later returned to the merchant (feature 4) or written off by admin.
- Merchant is notified with the cause and the amount.

### 6. Merchant self sign up

- Public page `/signup`: business name, contact name, email, Egyptian mobile, password, Shopify
  domain (optional). Creates a merchant `pending_approval` (is_active false) and a merchant user
  that cannot sign in until approved.
- Admin sees pending sign ups in `/admin/merchants` and approves or rejects (with reason).
  Approval activates both and notifies by the merchant panel. Rate limited like sign in.
- After approval the merchant panel shows an onboarding checklist: add products, set the 60 minute
  price, connect Shopify, send the first shipment.

## Error and rescue registry (short)

| Path | Failure | Handling |
|------|---------|----------|
| GET /track/:token | unknown token | 404, page shows "link not valid" |
| POST /rider/location | no order out | 204, ignored |
| POST /track/:token/rating | twice, or before delivery | 409 already_rated / not_delivered |
| Return request | units not available | 409 not_enough_available |
| Return pick | over pick | 409 over_pick |
| Damage approve | units no longer in damaged bin | 409 would_break_reservations path reused |
| Sign up | email or phone taken | 409 email_taken / phone_taken, rate limit 429 |

## Tests

Each feature ships with db tests for its rules, an API test for its endpoints and route access,
and messages in en and ar. Lint, typecheck and the full test suites pass before each commit.

## Rollout

One commit per feature on ShiplyNow, each followed by a Render redeploy; migrations are additive.
